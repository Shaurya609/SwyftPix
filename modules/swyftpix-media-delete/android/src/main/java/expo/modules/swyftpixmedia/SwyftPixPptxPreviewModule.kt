package expo.modules.swyftpixmedia

import android.net.Uri
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.zip.ZipFile

/** Native PPTX visual preview renderer. Reconstructs slide geometry, fills, text and embedded images. */
class SwyftPixPptxPreviewModule : Module() {
  private val context get() = appContext.reactContext ?: error("React context unavailable")

  override fun definition() = ModuleDefinition {
    Name("SwyftPixPptxPreview")
    View(SwyftPixPptxPreviewView::class) {
      Prop("html") { view: SwyftPixPptxPreviewView, html: String? -> view.loadHtml(html.orEmpty()) }
    }
    AsyncFunction("renderPptxHtml") { uriString: String -> renderPptxHtml(uriString) }
  }

  private data class SlideSize(val width: Double, val height: Double)
  private data class Bounds(val x: Double, val y: Double, val w: Double, val h: Double)

  private fun renderPptxHtml(uriString: String): String? {
    if (!uriString.startsWith("content://")) return null
    val temp = File(context.cacheDir, "pptx-render-${uriString.hashCode()}.pptx")
    return try {
      context.contentResolver.openInputStream(Uri.parse(uriString))?.use { input ->
        temp.outputStream().use { output -> input.copyTo(output) }
      } ?: return null
      ZipFile(temp).use { zip -> buildHtml(zip) }
    } catch (error: Exception) {
      android.util.Log.w("SwyftPixPptxPreview", "PPTX visual rendering failed", error)
      null
    } finally { temp.delete() }
  }

  private fun buildHtml(zip: ZipFile): String {
    val size = readSlideSize(zip)
    val entries = zip.entries().asSequence()
      .filter { !it.isDirectory && it.name.matches(Regex("ppt/slides/slide\\d+\\.xml")) }
      .sortedBy { Regex("slide(\\d+)\\.xml").find(it.name)?.groupValues?.get(1)?.toIntOrNull() ?: 0 }
      .toList()
    if (entries.isEmpty()) return ""

    val slides = entries.mapIndexed { index, entry -> renderSlide(zip, entry.name, index + 1, size) }.joinToString("")
    return """
      <!doctype html><html><head>
      <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes" />
      <style>
        *{box-sizing:border-box}html,body{margin:0;padding:0;background:#242424}
        body{padding:12px 0 28px;font-family:Arial,Helvetica,sans-serif}
        .slide{position:relative;width:min(1100px,calc(100vw - 16px));aspect-ratio:${size.width}/${size.height};margin:0 auto 16px;background:#fff;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.38)}
        .shape{position:absolute;overflow:hidden;white-space:pre-wrap;word-break:break-word}
        .picture{position:absolute;object-fit:contain}
        .slide-number{position:absolute;right:10px;bottom:7px;font-size:10px;color:rgba(0,0,0,.45);z-index:1000}
      </style></head><body>$slides</body></html>
    """.trimIndent()
  }

  private fun renderSlide(zip: ZipFile, slideName: String, number: Int, size: SlideSize): String {
    val xml = zip.getInputStream(zip.getEntry(slideName)).bufferedReader().readText()
    val rels = readRelationships(zip, slideName)
    val out = StringBuilder("<section class=\"slide\">")

    extractSolidFill(Regex("<p:bg\\b.*?</p:bg>", setOf(RegexOption.DOT_MATCHES_ALL)).find(xml)?.value.orEmpty())?.let {
      out.append("<div style=\"position:absolute;inset:0;background:$it\"></div>")
    }

    Regex("<p:sp\\b.*?</p:sp>", setOf(RegexOption.DOT_MATCHES_ALL)).findAll(xml).forEach { match ->
      val shape = match.value
      val bounds = extractBounds(shape, size) ?: return@forEach
      val text = extractText(shape)
      if (text.isBlank()) return@forEach
      val fill = extractSolidFill(shape)
      val fontSize = extractFontSize(shape)
      val color = extractTextColor(shape) ?: "#171717"
      val bold = Regex("<a:rPr\\b[^>]*b=\"1\"|<a:defRPr\\b[^>]*b=\"1\"").containsMatchIn(shape)
      val italic = Regex("<a:rPr\\b[^>]*i=\"1\"|<a:defRPr\\b[^>]*i=\"1\"").containsMatchIn(shape)
      val align = when {
        shape.contains("algn=\"ctr\"") -> "center"
        shape.contains("algn=\"r\"") -> "right"
        else -> "left"
      }
      val style = buildString {
        append("left:${bounds.x}%;top:${bounds.y}%;width:${bounds.w}%;height:${bounds.h}%;")
        append("padding:2px 4px;color:$color;font-size:${fontSize}px;line-height:1.15;text-align:$align;")
        if (fill != null) append("background:$fill;")
        if (bold) append("font-weight:700;")
        if (italic) append("font-style:italic;")
      }
      out.append("<div class=\"shape\" style=\"").append(style).append("\">")
        .append(escapeHtml(text)).append("</div>")
    }

    Regex("<p:pic\\b.*?</p:pic>", setOf(RegexOption.DOT_MATCHES_ALL)).findAll(xml).forEach { match ->
      val pic = match.value
      val bounds = extractBounds(pic, size) ?: return@forEach
      val embed = Regex("r:embed=\"([^\"]+)\"").find(pic)?.groupValues?.get(1) ?: return@forEach
      val target = rels[embed] ?: return@forEach
      val entryName = normalizeZipPath(slideName.substringBeforeLast('/') + "/" + target)
      val entry = zip.getEntry(entryName) ?: return@forEach
      val encoded = Base64.encodeToString(zip.getInputStream(entry).readBytes(), Base64.NO_WRAP)
      out.append("<img class=\"picture\" src=\"data:${mimeFor(entryName)};base64,$encoded\" style=\"")
        .append("left:${bounds.x}%;top:${bounds.y}%;width:${bounds.w}%;height:${bounds.h}%;\">")
    }

    out.append("<div class=\"slide-number\">$number</div></section>")
    return out.toString()
  }

  private fun readSlideSize(zip: ZipFile): SlideSize {
    val entry = zip.getEntry("ppt/presentation.xml") ?: return SlideSize(13.333, 7.5)
    val xml = zip.getInputStream(entry).bufferedReader().readText()
    val match = Regex("<p:sldSz[^>]*cx=\"(\\d+)\"[^>]*cy=\"(\\d+)\"").find(xml)
    val x = match?.groupValues?.get(1)?.toDoubleOrNull() ?: 12192000.0
    val y = match?.groupValues?.get(2)?.toDoubleOrNull() ?: 6858000.0
    return SlideSize(x, y)
  }

  private fun extractBounds(xml: String, size: SlideSize): Bounds? {
    val xfrm = Regex("<a:xfrm\\b.*?</a:xfrm>", setOf(RegexOption.DOT_MATCHES_ALL)).find(xml)?.value ?: return null
    val off = Regex("<a:off[^>]*x=\"(-?\\d+)\"[^>]*y=\"(-?\\d+)\"").find(xfrm) ?: return null
    val ext = Regex("<a:ext[^>]*cx=\"(\\d+)\"[^>]*cy=\"(\\d+)\"").find(xfrm) ?: return null
    val x = off.groupValues[1].toDoubleOrNull() ?: return null
    val y = off.groupValues[2].toDoubleOrNull() ?: return null
    val w = ext.groupValues[1].toDoubleOrNull() ?: return null
    val h = ext.groupValues[2].toDoubleOrNull() ?: return null
    return Bounds(x / size.width, y / size.height, w / size.width, h / size.height)
  }

  private fun extractText(xml: String): String = Regex("<a:t\\b[^>]*>(.*?)</a:t>", setOf(RegexOption.DOT_MATCHES_ALL)).findAll(xml)
    .map { xmlUnescape(stripXml(it.groupValues[1])) }.joinToString(" ").trim()

  private fun extractFontSize(xml: String): Int {
    val raw = Regex("<a:rPr[^>]*sz=\"(\\d+)\"").find(xml)?.groupValues?.get(1)?.toIntOrNull()
      ?: Regex("<a:defRPr[^>]*sz=\"(\\d+)\"").find(xml)?.groupValues?.get(1)?.toIntOrNull()
    return ((raw ?: 2200) / 100).coerceIn(8, 96)
  }

  private fun extractTextColor(xml: String): String? {
    val runProps = Regex("<a:rPr\\b.*?</a:rPr>|<a:defRPr\\b.*?</a:defRPr>", setOf(RegexOption.DOT_MATCHES_ALL)).find(xml)?.value ?: return null
    return extractSolidFill(runProps)
  }

  private fun extractSolidFill(xml: String): String? {
    val solid = Regex("<a:solidFill\\b.*?</a:solidFill>", setOf(RegexOption.DOT_MATCHES_ALL)).find(xml)?.value ?: return null
    Regex("<a:srgbClr[^>]*val=\"([0-9A-Fa-f]{6})\"").find(solid)?.groupValues?.get(1)?.let { return "#$it" }
    return when (Regex("<a:schemeClr[^>]*val=\"([^\"]+)\"").find(solid)?.groupValues?.get(1)?.lowercase()) {
      "dk1", "tx1" -> "#000000"; "lt1", "bg1" -> "#FFFFFF"; "dk2", "tx2" -> "#1F497D"; "lt2", "bg2" -> "#EEECE1"
      "accent1" -> "#4472C4"; "accent2" -> "#ED7D31"; "accent3" -> "#A5A5A5"; "accent4" -> "#FFC000"; "accent5" -> "#5B9BD5"; "accent6" -> "#70AD47"
      else -> null
    }
  }

  private fun readRelationships(zip: ZipFile, slideName: String): Map<String, String> {
    val relPath = slideName.substringBeforeLast('/') + "/_rels/" + slideName.substringAfterLast('/') + ".rels"
    val entry = zip.getEntry(relPath) ?: return emptyMap()
    val xml = zip.getInputStream(entry).bufferedReader().readText()
    return Regex("<Relationship\\b[^>]*Id=\"([^\"]+)\"[^>]*Target=\"([^\"]+)\"", RegexOption.DOT_MATCHES_ALL)
      .findAll(xml).associate { it.groupValues[1] to it.groupValues[2] }
  }

  private fun normalizeZipPath(path: String): String {
    val output = ArrayDeque<String>()
    path.replace('\\', '/').split('/').forEach { part -> when (part) { "", "." -> Unit; ".." -> if (output.isNotEmpty()) output.removeLast(); else -> output.addLast(part) } }
    return output.joinToString("/")
  }

  private fun mimeFor(path: String): String = when (path.substringAfterLast('.').lowercase()) {
    "png" -> "image/png"; "jpg", "jpeg" -> "image/jpeg"; "gif" -> "image/gif"; "svg" -> "image/svg+xml"; "webp" -> "image/webp"; else -> "application/octet-stream"
  }

  private fun stripXml(value: String): String = value.replace(Regex("<[^>]+>"), "")
  private fun xmlUnescape(value: String): String = value.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'")
  private fun escapeHtml(value: String): String = value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&#39;")
}
