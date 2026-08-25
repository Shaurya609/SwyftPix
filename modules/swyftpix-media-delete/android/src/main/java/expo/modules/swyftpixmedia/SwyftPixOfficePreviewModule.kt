package expo.modules.swyftpixmedia

import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.util.zip.ZipFile

/** Lightweight, dependency-free Office preview reader.
 * It extracts readable document structure from the OOXML packages used by
 * DOCX/XLSX/PPTX. It intentionally returns content rather than handing files
 * to another application, keeping preview inside SwyftPix.
 */
class SwyftPixOfficePreviewModule : Module() {
  private val context get() = appContext.reactContext ?: error("React context unavailable")

  override fun definition() = ModuleDefinition {
    Name("SwyftPixOfficePreview")

    AsyncFunction("readOfficeDocument") { uriString: String, type: String, maxChars: Int ->
      readOfficeDocument(uriString, type.lowercase(), maxChars.coerceIn(4096, 300000))
    }
  }

  private fun readOfficeDocument(uriString: String, type: String, maxChars: Int): String? {
    if (!uriString.startsWith("content://")) return null
    val temp = java.io.File(context.cacheDir, "office-preview-${uriString.hashCode()}.$type")
    return try {
      context.contentResolver.openInputStream(Uri.parse(uriString))?.use { input ->
        temp.outputStream().use { output -> input.copyTo(output) }
      } ?: return null
      ZipFile(temp).use { zip ->
        when (type) {
          "docx" -> readDocx(zip, maxChars)
          "xlsx" -> readXlsx(zip, maxChars)
          "pptx" -> readPptx(zip, maxChars)
          else -> null
        }
      }
    } catch (error: Exception) {
      android.util.Log.w("SwyftPixOfficePreview", "Office preview failed for $type", error)
      null
    } finally {
      temp.delete()
    }
  }

  private fun readDocx(zip: ZipFile, maxChars: Int): String {
    val xml = zip.getEntry("word/document.xml")?.let { zip.getInputStream(it).bufferedReader().readText() } ?: return ""
    val paragraphs = Regex("<w:p\\b[^>]*>(.*?)</w:p>", setOf(RegexOption.DOT_MATCHES_ALL)).findAll(xml)
    val out = StringBuilder()
    for (paragraph in paragraphs) {
      val texts = Regex("<w:t\\b[^>]*>(.*?)</w:t>", setOf(RegexOption.DOT_MATCHES_ALL)).findAll(paragraph.groupValues[1])
        .joinToString("") { xmlUnescape(stripXml(it.groupValues[1])) }
      if (texts.isNotEmpty()) appendLimited(out, texts, maxChars)
      if (out.length < maxChars) out.append('\n')
      if (out.length >= maxChars) break
    }
    return out.toString().trim()
  }

  private fun readXlsx(zip: ZipFile, maxChars: Int): String {
    val shared = mutableListOf<String>()
    zip.getEntry("xl/sharedStrings.xml")?.let { entry ->
      val xml = zip.getInputStream(entry).bufferedReader().readText()
      Regex("<si\\b[^>]*>(.*?)</si>", setOf(RegexOption.DOT_MATCHES_ALL)).findAll(xml).forEach { si ->
        shared.add(Regex("<t\\b[^>]*>(.*?)</t>", setOf(RegexOption.DOT_MATCHES_ALL)).findAll(si.groupValues[1])
          .joinToString("") { xmlUnescape(stripXml(it.groupValues[1])) })
      }
    }
    val sheet = zip.getEntry("xl/worksheets/sheet1.xml") ?: return ""
    val xml = zip.getInputStream(sheet).bufferedReader().readText()
    val out = StringBuilder()
    Regex("<row\\b[^>]*>(.*?)</row>", setOf(RegexOption.DOT_MATCHES_ALL)).findAll(xml).forEach { row ->
      val cells = mutableListOf<String>()
      Regex("<c\\b([^>]*)>(.*?)</c>", setOf(RegexOption.DOT_MATCHES_ALL)).findAll(row.groupValues[1]).forEach { cell ->
        val attrs = cell.groupValues[1]
        val body = cell.groupValues[2]
        val value = Regex("<v\\b[^>]*>(.*?)</v>", setOf(RegexOption.DOT_MATCHES_ALL)).find(body)?.groupValues?.get(1)?.let(::stripXml) ?: ""
        val inline = Regex("<t\\b[^>]*>(.*?)</t>", setOf(RegexOption.DOT_MATCHES_ALL)).find(body)?.groupValues?.get(1)?.let { xmlUnescape(stripXml(it)) }
        val result = if (attrs.contains("t=\"s\"")) shared.getOrNull(value.toIntOrNull() ?: -1) ?: value else inline ?: xmlUnescape(value)
        cells.add(result)
      }
      if (cells.isNotEmpty()) appendLimited(out, cells.joinToString("\t"), maxChars).append('\n')
      if (out.length >= maxChars) return@forEach
    }
    return out.toString().trim()
  }

  private fun readPptx(zip: ZipFile, maxChars: Int): String {
    val slideNames = zip.entries().asSequence()
      .filter { !it.isDirectory && it.name.matches(Regex("ppt/slides/slide\\d+\\.xml")) }
      .sortedBy { Regex("slide(\\d+)\\.xml").find(it.name)?.groupValues?.get(1)?.toIntOrNull() ?: 0 }
      .map { it.name }
      .toList()
    val out = StringBuilder()
    slideNames.forEachIndexed { index, name ->
      if (out.length >= maxChars) return@forEachIndexed
      appendLimited(out, "Slide ${index + 1}", maxChars).append('\n')
      val xml = zip.getEntry(name)?.let { zip.getInputStream(it).bufferedReader().readText() } ?: return@forEachIndexed
      val texts = Regex("<a:t\\b[^>]*>(.*?)</a:t>", setOf(RegexOption.DOT_MATCHES_ALL)).findAll(xml)
        .map { xmlUnescape(stripXml(it.groupValues[1])) }.filter { it.isNotBlank() }.toList()
      texts.forEach { text ->
        if (out.length < maxChars) appendLimited(out, text, maxChars).append('\n')
      }
    }
    return out.toString().trim()
  }

  private fun appendLimited(out: StringBuilder, value: String, maxChars: Int): StringBuilder {
    if (out.length >= maxChars) return out
    val remaining = maxChars - out.length
    out.append(value.take(remaining))
    return out
  }

  private fun stripXml(value: String): String = value.replace(Regex("<[^>]+>"), "")

  private fun xmlUnescape(value: String): String = value
    .replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    .replace("&quot;", "\"").replace("&apos;", "'")
}