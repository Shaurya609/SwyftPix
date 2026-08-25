package expo.modules.swyftpixmedia

import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.io.File
import java.util.zip.ZipFile

/**
 * Native Office preview reader.
 *
 * DOCX is rendered to a self-contained HTML document so Android WebView can
 * display the document layout inside SwyftPix instead of showing extracted
 * plain text. XLSX/PPTX keep their existing structure-reader path for now.
 */
class SwyftPixOfficePreviewModule : Module() {
  private val context get() = appContext.reactContext ?: error("React context unavailable")

  override fun definition() = ModuleDefinition {
    Name("SwyftPixOfficePreview")

    View(SwyftPixOfficePreviewView::class) {
      Prop("html") { view: SwyftPixOfficePreviewView, html: String? ->
        view.loadHtml(html.orEmpty())
      }
    }

    AsyncFunction("readOfficeDocument") { uriString: String, type: String, maxChars: Int ->
      readOfficeDocument(uriString, type.lowercase(), maxChars.coerceIn(4096, 300000))
    }

    AsyncFunction("renderDocxHtml") { uriString: String ->
      renderDocxHtml(uriString)
    }
  }

  private fun readOfficeDocument(uriString: String, type: String, maxChars: Int): String? {
    if (!uriString.startsWith("content://")) return null
    val temp = File(context.cacheDir, "office-preview-${uriString.hashCode()}.$type")
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

  private fun renderDocxHtml(uriString: String): String? {
    if (!uriString.startsWith("content://")) return null
    val temp = File(context.cacheDir, "docx-render-${uriString.hashCode()}.docx")
    return try {
      context.contentResolver.openInputStream(Uri.parse(uriString))?.use { input ->
        temp.outputStream().use { output -> input.copyTo(output) }
      } ?: return null
      ZipFile(temp).use { zip -> buildDocxHtml(zip) }
    } catch (error: Exception) {
      android.util.Log.w("SwyftPixOfficePreview", "DOCX visual rendering failed", error)
      null
    } finally {
      temp.delete()
    }
  }

  private fun buildDocxHtml(zip: ZipFile): String {
    val xml = zip.getEntry("word/document.xml")?.let {
      zip.getInputStream(it).bufferedReader().readText()
    } ?: return ""

    val body = Regex("<w:body\\b[^>]*>(.*?)</w:body>", setOf(RegexOption.DOT_MATCHES_ALL))
      .find(xml)?.groupValues?.get(1) ?: xml

    val html = StringBuilder()
    val blocks = Regex("<w:p\\b[^>]*>(.*?)</w:p>|<w:tbl\\b[^>]*>(.*?)</w:tbl>", setOf(RegexOption.DOT_MATCHES_ALL))
    blocks.findAll(body).forEach { match ->
      val paragraph = match.groupValues.getOrNull(1).orEmpty()
      val table = match.groupValues.getOrNull(2).orEmpty()
      if (table.isNotEmpty()) {
        html.append(renderTable(table))
      } else if (paragraph.isNotEmpty()) {
        html.append(renderParagraph(paragraph))
      }
    }

    if (html.isEmpty()) return ""
    return """
      <!doctype html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=4, user-scalable=yes" />
        <style>
          * { box-sizing: border-box; }
          html, body { margin: 0; padding: 0; background: #ececec; color: #202124; }
          body { font-family: Arial, Helvetica, sans-serif; font-size: 16px; line-height: 1.45; padding: 14px 0 32px; }
          .page { width: min(794px, calc(100vw - 24px)); min-height: 1123px; margin: 0 auto 18px; padding: 58px 64px; background: white; box-shadow: 0 1px 6px rgba(0,0,0,.16); overflow-wrap: anywhere; }
          p { margin: 0 0 11px; white-space: pre-wrap; }
          h1, h2, h3, h4, h5, h6 { margin: 0 0 14px; line-height: 1.2; }
          table { width: 100%; border-collapse: collapse; margin: 14px 0; table-layout: auto; }
          td, th { border: 1px solid #9a9a9a; padding: 6px 8px; vertical-align: top; }
          .page-break { break-before: page; page-break-before: always; }
          img { max-width: 100%; height: auto; }
          @media (max-width: 600px) {
            body { font-size: 15px; }
            .page { width: calc(100vw - 16px); min-height: auto; padding: 28px 24px; }
          }
        </style>
      </head>
      <body><section class="page">$html</section></body>
      </html>
    """.trimIndent()
  }

  private fun renderParagraph(xml: String): String {
    val pPr = Regex("<w:pPr\\b[^>]*>(.*?)</w:pPr>", setOf(RegexOption.DOT_MATCHES_ALL)).find(xml)?.groupValues?.get(1).orEmpty()
    val styleId = Regex("<w:pStyle[^>]*w:val=\"([^\"]+)\"", RegexOption.DOT_MATCHES_ALL).find(pPr)?.groupValues?.get(1)?.lowercase().orEmpty()
    val alignment = Regex("<w:jc[^>]*w:val=\"([^\"]+)\"", RegexOption.DOT_MATCHES_ALL).find(pPr)?.groupValues?.get(1)?.lowercase()
    val isHeading = styleId.contains("heading")
    val headingLevel = Regex("heading([1-6])").find(styleId)?.groupValues?.get(1)?.toIntOrNull()
    val tag = headingLevel?.let { "h$it" } ?: if (isHeading) "h2" else "p"
    val align = when (alignment) {
      "center" -> "text-align:center;"
      "right" -> "text-align:right;"
      "both", "justify" -> "text-align:justify;"
      else -> "text-align:left;"
    }
    val indent = Regex("<w:ind[^>]*w:left=\"(\\d+)\"", RegexOption.DOT_MATCHES_ALL).find(pPr)?.groupValues?.get(1)?.toIntOrNull()
    val margin = indent?.let { "margin-left:${(it / 15).coerceAtMost(300)}px;" }.orEmpty()
    val pageBreak = if (xml.contains("<w:br") && xml.contains("w:type=\"page\"")) "<div class=\"page-break\"></div>" else ""

    val content = StringBuilder()
    val runRegex = Regex("<w:r\\b[^>]*>(.*?)</w:r>", setOf(RegexOption.DOT_MATCHES_ALL))
    runRegex.findAll(xml).forEach { run ->
      val runXml = run.groupValues[1]
      val runPr = Regex("<w:rPr\\b[^>]*>(.*?)</w:rPr>", setOf(RegexOption.DOT_MATCHES_ALL)).find(runXml)?.groupValues?.get(1).orEmpty()
      var text = Regex("<w:t\\b[^>]*>(.*?)</w:t>", setOf(RegexOption.DOT_MATCHES_ALL)).findAll(runXml)
        .joinToString("") { escapeHtml(xmlUnescape(stripXml(it.groupValues[1]))) }
      if (text.isEmpty() && runXml.contains("<w:tab")) text = "&emsp;"
      if (text.isEmpty()) return@forEach
      if (runPr.contains("<w:b")) text = "<strong>$text</strong>"
      if (runPr.contains("<w:i")) text = "<em>$text</em>"
      if (runPr.contains("<w:u")) text = "<u>$text</u>"
      val size = Regex("<w:sz[^>]*w:val=\"(\\d+)\"", RegexOption.DOT_MATCHES_ALL).find(runPr)?.groupValues?.get(1)?.toIntOrNull()
      if (size != null) text = "<span style=\"font-size:${(size / 2).coerceIn(8, 72)}pt\">$text</span>"
      content.append(text)
    }
    return if (content.isNotEmpty()) pageBreak + "<$tag style=\"$align$margin\">$content</$tag>" else pageBreak
  }

  private fun renderTable(xml: String): String {
    val rows = Regex("<w:tr\\b[^>]*>(.*?)</w:tr>", setOf(RegexOption.DOT_MATCHES_ALL)).findAll(xml)
    val out = StringBuilder("<table>")
    rows.forEach { row ->
      out.append("<tr>")
      Regex("<w:tc\\b[^>]*>(.*?)</w:tc>", setOf(RegexOption.DOT_MATCHES_ALL)).findAll(row.groupValues[1]).forEach { cell ->
        val text = Regex("<w:t\\b[^>]*>(.*?)</w:t>", setOf(RegexOption.DOT_MATCHES_ALL)).findAll(cell.groupValues[1])
          .joinToString("") { escapeHtml(xmlUnescape(stripXml(it.groupValues[1]))) }
        out.append("<td>").append(text).append("</td>")
      }
      out.append("</tr>")
    }
    return out.append("</table>").toString()
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

  private fun escapeHtml(value: String): String = value
    .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    .replace("\"", "&quot;").replace("'", "&#39;")
}