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
  private data class RawBounds(val x: Double, val y: Double, val w: Double, val h: Double)
  private data class GroupTransform(val x: Double, val y: Double, val w: Double, val h: Double, val childX: Double, val childY: Double, val childW: Double, val childH: Double)
  private data class GroupRange(val start: Int, val end: Int, val transform: GroupTransform)

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
    } finally {
      temp.delete()
    }
  }

  private fun buildHtml(zip: ZipFile): String {
    val size = readSlideSize(zip)
    val entries = zip.entries().asSequence()
      .filter { !it.isDirectory && it.name.matches(Regex("ppt/slides/slide\\d+\\.xml")) }
      .sortedBy { Regex("slide(\\d+)\\.xml").find(it.name)?.groupValues?.get(1)?.toIntOrNull() ?: 0 }
      .toList()

    if (entries.isEmpty()) return ""

    val slides = entries.mapIndexed { index, entry ->
      renderSlide(zip, entry.name, index + 1, size)
    }.joinToString("")

    return """
      <!doctype html><html><head>
      <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes" />
      <style>
        *{box-sizing:border-box}
        html,body{margin:0;padding:0;width:100%;height:100%;background:#242424;overflow:hidden}
        body{font-family:Arial,Helvetica,sans-serif}
        #slides{width:100%;height:100%;display:flex;align-items:center;justify-content:center}
        .slide{display:none;position:relative;width:min(1100px,calc(100vw - 16px));aspect-ratio:${size.width}/${size.height};margin:0 auto;background:#fff;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.38)}
        .slide.active{display:block}
        .shape{position:absolute;overflow:hidden;white-space:pre-wrap;word-break:break-word}
        .picture{position:absolute;object-fit:contain}
        .table-frame{position:absolute;overflow:hidden;background:rgba(255,255,255,.92)}
        .ppt-table{width:100%;height:100%;border-collapse:collapse;table-layout:fixed;color:#171717;font-size:1.45vw;line-height:1.1}
        .ppt-table td{border:1px solid rgba(0,0,0,.35);padding:2px;vertical-align:middle;white-space:pre-wrap;word-break:break-word}
        .slide-number{position:absolute;right:10px;bottom:7px;font-size:10px;color:rgba(0,0,0,.45);z-index:1000}
        .pptx-controls{position:fixed;z-index:2000;left:50%;bottom:12px;transform:translateX(-50%);display:flex;align-items:center;gap:10px;padding:6px 10px;border-radius:22px;background:rgba(0,0,0,.78);color:#fff;font-size:12px}
        .pptx-controls button{width:34px;height:34px;border:0;border-radius:17px;background:#fff;color:#111;font-size:24px;line-height:1;cursor:pointer}
      </style></head><body><main id="slides">$slides</main>
      <div class="pptx-controls"><button type="button" id="previous" aria-label="Previous slide">‹</button><span id="slide-status"></span><button type="button" id="next" aria-label="Next slide">›</button></div>
      <script>
        const slides=Array.from(document.querySelectorAll('.slide'));
        const status=document.getElementById('slide-status');
        let index=0;
        function show(next){
          if(!slides.length)return;
          index=(next+slides.length)%slides.length;
          slides.forEach((slide,position)=>slide.classList.toggle('active',position===index));
          status.textContent=(index+1)+' / '+slides.length;
        }
        document.getElementById('previous').addEventListener('click',()=>show(index-1));
        document.getElementById('next').addEventListener('click',()=>show(index+1));
        let touchStart=0;
        document.addEventListener('touchstart',event=>{touchStart=event.changedTouches[0].screenX},{passive:true});
        document.addEventListener('touchend',event=>{const delta=event.changedTouches[0].screenX-touchStart;if(Math.abs(delta)>55)show(index+(delta<0?1:-1))},{passive:true});
        show(0);
      </script></body></html>
    """.trimIndent()
  }

  private fun renderSlide(zip: ZipFile, slideName: String, number: Int, size: SlideSize): String {
    val xml = zip.getInputStream(zip.getEntry(slideName)).bufferedReader().readText()
    val rels = readRelationships(zip, slideName)
    val groups = findGroupRanges(xml)
    val out = StringBuilder("<section class=\"slide\">")

    extractShapeBackgroundFill(Regex("<p:bg\\b.*?</p:bg>", setOf(RegexOption.DOT_MATCHES_ALL)).find(xml)?.value.orEmpty())?.let {
      out.append("<div style=\"position:absolute;inset:0;background:$it\"></div>")
    }

    Regex("<p:sp\\b.*?</p:sp>", setOf(RegexOption.DOT_MATCHES_ALL)).findAll(xml).forEach { match ->
      val shape = match.value
      val bounds = extractBounds(shape, size, transformsFor(groups, match.range.first)) ?: return@forEach
      // IMPORTANT: shape fill and text color live in different XML branches.
      // The old implementation searched the entire shape for <a:solidFill>,
      // which often found the text color and incorrectly painted the text box
      // with that color. That produced the large dark rectangles seen in the
      // PPTX preview.
      val fill = extractShapeFill(shape)
      val text = extractText(shape)
      if (text.isBlank() && fill == null) return@forEach
      val fontSize = extractFontSize(shape)
      val color = extractTextColor(shape) ?: "#171717"
      val bold = Regex("<a:rPr\\b[^>]*b=\"1\"|<a:defRPr\\b[^>]*b=\"1\"").containsMatchIn(shape)
      val italic = Regex("<a:rPr\\b[^>]*i=\"1\"|<a:defRPr\\b[^>]*i=\"1\"").containsMatchIn(shape)
      val align = when {
        shape.contains("algn=\"ctr\"") -> "center"
        shape.contains("algn=\"r\"") -> "right"
        else -> "left"
      }

      // PPT font sizes are expressed in points. The slide is rendered at a
      // variable CSS width, so express the font size relative to the slide
      // viewport instead of using a fixed px value. This prevents text from
      // becoming huge when the slide is displayed on a phone.
      val responsiveFont = (fontSize * 1.333 / 11.0).coerceAtLeast(0.9)
      val style = buildString {
        append("left:${bounds.x}%;top:${bounds.y}%;width:${bounds.w}%;height:${bounds.h}%;")
        append("padding:2px 4px;color:$color;font-size:${"%.3f".format(java.util.Locale.US, responsiveFont)}vw;line-height:1.15;text-align:$align;")
        if (fill != null) append("background:$fill;")
        if (bold) append("font-weight:700;")
        if (italic) append("font-style:italic;")
      }

      out.append("<div class=\"shape\" style=\"")
        .append(style)
        .append("\">")
        .append(escapeHtml(text))
        .append("</div>")
    }

    Regex("<p:graphicFrame\\b.*?</p:graphicFrame>", setOf(RegexOption.DOT_MATCHES_ALL)).findAll(xml).forEach { match ->
      val frame = match.value
      val bounds = extractBounds(frame, size, transformsFor(groups, match.range.first)) ?: return@forEach
      val table = Regex("<a:tbl\\b.*?</a:tbl>", setOf(RegexOption.DOT_MATCHES_ALL)).find(frame)?.value ?: return@forEach
      out.append(renderTable(table, bounds))
    }

    Regex("<p:pic\\b.*?</p:pic>", setOf(RegexOption.DOT_MATCHES_ALL)).findAll(xml).forEach { match ->
      val pic = match.value
      val bounds = extractBounds(pic, size, transformsFor(groups, match.range.first)) ?: return@forEach
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
    val entry = zip.getEntry("ppt/presentation.xml") ?: return SlideSize(12192000.0, 6858000.0)
    val xml = zip.getInputStream(entry).bufferedReader().readText()
    val match = Regex("<p:sldSz[^>]*cx=\"(\\d+)\"[^>]*cy=\"(\\d+)\"").find(xml)
    val x = match?.groupValues?.get(1)?.toDoubleOrNull() ?: 12192000.0
    val y = match?.groupValues?.get(2)?.toDoubleOrNull() ?: 6858000.0
    return SlideSize(x, y)
  }

  private fun extractBounds(xml: String, size: SlideSize, transforms: List<GroupTransform> = emptyList()): Bounds? {
    val xfrm = Regex("<(?:a|p):xfrm\\b.*?</(?:a|p):xfrm>", setOf(RegexOption.DOT_MATCHES_ALL)).find(xml)?.value ?: return null
    val off = Regex("<a:off[^>]*x=\"(-?\\d+)\"[^>]*y=\"(-?\\d+)\"").find(xfrm) ?: return null
    val ext = Regex("<a:ext[^>]*cx=\"(\\d+)\"[^>]*cy=\"(\\d+)\"").find(xfrm) ?: return null
    var raw = RawBounds(
      off.groupValues[1].toDoubleOrNull() ?: return null,
      off.groupValues[2].toDoubleOrNull() ?: return null,
      ext.groupValues[1].toDoubleOrNull() ?: return null,
      ext.groupValues[2].toDoubleOrNull() ?: return null
    )
    transforms.forEach { group ->
      raw = RawBounds(
        group.x + (raw.x - group.childX) * group.w / group.childW,
        group.y + (raw.y - group.childY) * group.h / group.childH,
        raw.w * group.w / group.childW,
        raw.h * group.h / group.childH
      )
    }
    return Bounds(
      raw.x / size.width * 100.0,
      raw.y / size.height * 100.0,
      raw.w / size.width * 100.0,
      raw.h / size.height * 100.0
    )
  }

  private fun findGroupRanges(xml: String): List<GroupRange> {
    val starts = ArrayDeque<Int>()
    val ranges = mutableListOf<GroupRange>()
    Regex("<p:grpSp\\b|</p:grpSp>").findAll(xml).forEach { match ->
      if (match.value.startsWith("</")) {
        val start = starts.removeLastOrNull() ?: return@forEach
        val content = xml.substring(start, match.range.last + 1)
        extractGroupTransform(content)?.let { ranges.add(GroupRange(start, match.range.last, it)) }
      } else starts.addLast(match.range.first)
    }
    return ranges
  }

  private fun extractGroupTransform(xml: String): GroupTransform? {
    val properties = Regex("<p:grpSpPr\\b.*?</p:grpSpPr>", setOf(RegexOption.DOT_MATCHES_ALL)).find(xml)?.value ?: return null
    val xfrm = Regex("<a:xfrm\\b.*?</a:xfrm>", setOf(RegexOption.DOT_MATCHES_ALL)).find(properties)?.value ?: return null
    fun pair(tag: String, first: String, second: String): Pair<Double, Double>? {
      val found = Regex("<$tag[^>]*$first=\"(-?\\d+)\"[^>]*$second=\"(-?\\d+)\"").find(xfrm) ?: return null
      return (found.groupValues[1].toDoubleOrNull() ?: return null) to (found.groupValues[2].toDoubleOrNull() ?: return null)
    }
    val off = pair("a:off", "x", "y") ?: return null
    val ext = pair("a:ext", "cx", "cy") ?: return null
    val childOff = pair("a:chOff", "x", "y") ?: (0.0 to 0.0)
    val childExt = pair("a:chExt", "cx", "cy") ?: ext
    if (childExt.first == 0.0 || childExt.second == 0.0) return null
    return GroupTransform(off.first, off.second, ext.first, ext.second, childOff.first, childOff.second, childExt.first, childExt.second)
  }

  private fun transformsFor(groups: List<GroupRange>, position: Int): List<GroupTransform> =
    groups.filter { position in it.start..it.end }.sortedByDescending { it.start }.map { it.transform }

  private fun renderTable(table: String, bounds: Bounds): String {
    val rows = Regex("<a:tr\\b.*?</a:tr>", setOf(RegexOption.DOT_MATCHES_ALL)).findAll(table).map { row ->
      Regex("<a:tc\\b.*?</a:tc>", setOf(RegexOption.DOT_MATCHES_ALL)).findAll(row.value).map { cell ->
        extractText(cell.value)
      }.toList()
    }.toList()
    if (rows.isEmpty()) return ""
    val style = "left:${bounds.x}%;top:${bounds.y}%;width:${bounds.w}%;height:${bounds.h}%;"
    val htmlRows = rows.joinToString("") { row ->
      "<tr>" + row.joinToString("") { text -> "<td>${escapeHtml(text)}</td>" } + "</tr>"
    }
    return "<div class=\"table-frame\" style=\"$style\"><table class=\"ppt-table\"><tbody>$htmlRows</tbody></table></div>"
  }

  private fun extractText(xml: String): String {
    val paragraphs = Regex("<a:p\\b.*?</a:p>", setOf(RegexOption.DOT_MATCHES_ALL)).findAll(xml)
      .map { paragraph ->
        Regex("<a:t\\b[^>]*>(.*?)</a:t>", setOf(RegexOption.DOT_MATCHES_ALL)).findAll(paragraph.value)
          .map { xmlUnescape(stripXml(it.groupValues[1])) }
          .joinToString("")
      }
      .filter { it.isNotBlank() }
      .toList()

    return if (paragraphs.isNotEmpty()) paragraphs.joinToString("\n") else {
      Regex("<a:t\\b[^>]*>(.*?)</a:t>", setOf(RegexOption.DOT_MATCHES_ALL)).findAll(xml)
        .map { xmlUnescape(stripXml(it.groupValues[1])) }
        .joinToString("")
        .trim()
    }
  }

  private fun extractFontSize(xml: String): Int {
    val raw = Regex("<a:rPr[^>]*sz=\"(\\d+)\"").find(xml)?.groupValues?.get(1)?.toIntOrNull()
      ?: Regex("<a:defRPr[^>]*sz=\"(\\d+)\"").find(xml)?.groupValues?.get(1)?.toIntOrNull()
    return ((raw ?: 2200) / 100).coerceIn(8, 96)
  }

  private fun extractTextColor(xml: String): String? {
    val runProps = Regex("<a:rPr\\b.*?</a:rPr>|<a:defRPr\\b.*?</a:defRPr>", setOf(RegexOption.DOT_MATCHES_ALL)).find(xml)?.value ?: return null
    return extractSolidFill(runProps)
  }

  private fun extractShapeFill(xml: String): String? {
    val shapeProperties = Regex("<p:spPr\\b.*?</p:spPr>", setOf(RegexOption.DOT_MATCHES_ALL)).find(xml)?.value ?: return null
    return extractSolidFill(shapeProperties)
  }

  private fun extractShapeBackgroundFill(xml: String): String? = extractSolidFill(xml)

  private fun extractSolidFill(xml: String): String? {
    val solid = Regex("<a:solidFill\\b.*?</a:solidFill>", setOf(RegexOption.DOT_MATCHES_ALL)).find(xml)?.value ?: return null
    Regex("<a:srgbClr[^>]*val=\"([0-9A-Fa-f]{6})\"").find(solid)?.groupValues?.get(1)?.let { return "#$it" }
    return when (Regex("<a:schemeClr[^>]*val=\"([^\"]+)\"").find(solid)?.groupValues?.get(1)?.lowercase()) {
      "dk1", "tx1" -> "#000000"
      "lt1", "bg1" -> "#FFFFFF"
      "dk2", "tx2" -> "#1F497D"
      "lt2", "bg2" -> "#EEECE1"
      "accent1" -> "#4472C4"
      "accent2" -> "#ED7D31"
      "accent3" -> "#A5A5A5"
      "accent4" -> "#FFC000"
      "accent5" -> "#5B9BD5"
      "accent6" -> "#70AD47"
      else -> null
    }
  }

  private fun readRelationships(zip: ZipFile, slideName: String): Map<String, String> {
    val relPath = slideName.substringBeforeLast('/') + "/_rels/" + slideName.substringAfterLast('/') + ".rels"
    val entry = zip.getEntry(relPath) ?: return emptyMap()
    val xml = zip.getInputStream(entry).bufferedReader().readText()
    return Regex("<Relationship\\b[^>]*Id=\"([^\"]+)\"[^>]*Target=\"([^\"]+)\"", RegexOption.DOT_MATCHES_ALL)
      .findAll(xml)
      .associate { it.groupValues[1] to it.groupValues[2] }
  }

  private fun normalizeZipPath(path: String): String {
    val output = ArrayDeque<String>()
    path.replace('\\', '/').split('/').forEach { part ->
      when (part) {
        "", "." -> Unit
        ".." -> if (output.isNotEmpty()) output.removeLast()
        else -> output.addLast(part)
      }
    }
    return output.joinToString("/")
  }

  private fun mimeFor(path: String): String = when (path.substringAfterLast('.').lowercase()) {
    "png" -> "image/png"
    "jpg", "jpeg" -> "image/jpeg"
    "gif" -> "image/gif"
    "svg" -> "image/svg+xml"
    "webp" -> "image/webp"
    else -> "application/octet-stream"
  }

  private fun stripXml(value: String): String = value.replace(Regex("<[^>]+>"), "")

  private fun xmlUnescape(value: String): String = value
    .replace("&amp;", "&")
    .replace("&lt;", "<")
    .replace("&gt;", ">")
    .replace("&quot;", "\"")
    .replace("&apos;", "'")

  private fun escapeHtml(value: String): String = value
    .replace("&", "&amp;")
    .replace("<", "&lt;")
    .replace(">", "&gt;")
    .replace("\"", "&quot;")
    .replace("'", "&#39;")
}
