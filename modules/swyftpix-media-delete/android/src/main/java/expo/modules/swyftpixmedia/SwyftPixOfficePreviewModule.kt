package expo.modules.swyftpixmedia

import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.text.DecimalFormat
import java.util.Calendar
import java.util.Locale
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

    AsyncFunction("renderXlsxHtml") { uriString: String, thumbnail: Boolean ->
      renderXlsxHtml(uriString, thumbnail)
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

  private fun renderXlsxHtml(uriString: String, thumbnail: Boolean): String? {
    if (!uriString.startsWith("content://")) return null
    val temp = File(context.cacheDir, "xlsx-render-${uriString.hashCode()}.xlsx")
    return try {
      context.contentResolver.openInputStream(Uri.parse(uriString))?.use { input ->
        temp.outputStream().use { output -> input.copyTo(output) }
      } ?: return null
      ZipFile(temp).use { zip -> buildXlsxHtml(zip, thumbnail) }
    } catch (error: Exception) {
      android.util.Log.w("SwyftPixOfficePreview", "XLSX visual rendering failed", error)
      null
    } finally {
      temp.delete()
    }
  }

  private data class XlsxStyle(val fill: String?, val color: String?, val bold: Boolean, val italic: Boolean, val formatId: Int)
  private data class XlsxCell(val value: String, val style: Int, val numeric: Boolean)

  private fun buildXlsxHtml(zip: ZipFile, thumbnail: Boolean): String {
    val shared = readSharedStrings(zip)
    val styles = readXlsxStyles(zip)
    val workbook = readZipText(zip, "xl/workbook.xml") ?: return ""
    val workbookRels = readRelationships(zip, "xl/workbook.xml")
    val sheets = Regex("<sheet\\b([^>]*)/?>").findAll(workbook).mapNotNull { match ->
      val attrs = match.groupValues[1]
      val name = attribute(attrs, "name") ?: return@mapNotNull null
      val relationId = attribute(attrs, "r:id") ?: return@mapNotNull null
      val target = workbookRels[relationId] ?: return@mapNotNull null
      val path = normalizeZipPath("xl/$target")
      if (zip.getEntry(path) == null) null else name to path
    }.toList()
    if (sheets.isEmpty()) return ""

    val maxRows = if (thumbnail) 24 else 200
    val maxColumns = if (thumbnail) 10 else 50
    val pages = sheets.mapIndexed { index, (name, path) ->
      "<section class=\"worksheet${if (index == 0) " active" else ""}\" id=\"sheet-$index\">${renderWorksheet(readZipText(zip, path).orEmpty(), shared, styles, maxRows, maxColumns)}</section>"
    }.joinToString("")
    val tabs = sheets.mapIndexed { index, (name, _) ->
      "<button class=\"sheet-tab${if (index == 0) " active" else ""}\" data-sheet=\"$index\">${escapeHtml(name)}</button>"
    }.joinToString("")
    return """
      <!doctype html><html><head>
      <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes" />
      <style>
        *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:#f0f2f5;color:#202124;font-family:Arial,Helvetica,sans-serif;overflow:hidden}
        #book{height:100%;display:flex;flex-direction:column}.sheet-tabs{display:flex;gap:1px;overflow-x:auto;background:#e2e5e9;min-height:38px}.sheet-tab{border:0;border-bottom:3px solid transparent;background:#e2e5e9;color:#48515a;padding:9px 14px;white-space:nowrap;font-weight:700;font-size:12px}.sheet-tab.active{background:#fff;color:#137333;border-bottom-color:#137333}
        .worksheet{display:none;flex:1;min-height:0;overflow:auto;padding:10px;background:#f0f2f5}.worksheet.active{display:block}.grid{border-collapse:collapse;table-layout:fixed;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.14);font-size:13px}.grid th{position:sticky;top:0;z-index:3;background:#f1f3f4;color:#5f6368;font-size:11px;font-weight:700;text-align:center;min-width:42px;height:24px}.grid .row-head{position:sticky;left:0;z-index:2;background:#f1f3f4;color:#5f6368;font-size:11px;font-weight:700;text-align:right;padding:0 7px;min-width:38px}.grid th:first-child{z-index:4}.grid td{height:24px;min-width:76px;border:1px solid #d9dde3;padding:3px 5px;vertical-align:middle;white-space:pre-wrap;overflow:hidden;word-break:break-word}.grid td.number{text-align:right}.empty-sheet{padding:26px;color:#6b7280;background:#fff;text-align:center}.note{font-size:11px;color:#6b7280;padding:7px 10px;background:#fff;border-top:1px solid #d9dde3}
      </style></head><body><main id="book"><nav class="sheet-tabs">$tabs</nav>$pages</main>
      <script>document.querySelectorAll('.sheet-tab').forEach(tab=>tab.addEventListener('click',()=>{const selected=tab.dataset.sheet;document.querySelectorAll('.sheet-tab').forEach(item=>item.classList.toggle('active',item===tab));document.querySelectorAll('.worksheet').forEach(sheet=>sheet.classList.toggle('active',sheet.id==='sheet-'+selected));}));</script>
      </body></html>
    """.trimIndent()
  }

  private fun renderWorksheet(xml: String, shared: List<String>, styles: List<XlsxStyle>, maxRows: Int, maxColumns: Int): String {
    if (xml.isBlank()) return "<div class=\"empty-sheet\">This worksheet is empty.</div>"
    val cells = mutableMapOf<Pair<Int, Int>, XlsxCell>()
    Regex("<c\\b([^>]*)(?:/>|>(.*?)</c>)", setOf(RegexOption.DOT_MATCHES_ALL)).findAll(xml).forEach { match ->
      val attrs = match.groupValues[1]
      val location = attribute(attrs, "r") ?: return@forEach
      val (row, column) = cellLocation(location) ?: return@forEach
      if (row >= maxRows || column >= maxColumns) return@forEach
      val body = match.groupValues.getOrElse(2) { "" }
      val type = attribute(attrs, "t").orEmpty()
      val style = attribute(attrs, "s")?.toIntOrNull() ?: 0
      val raw = Regex("<v\\b[^>]*>(.*?)</v>", RegexOption.DOT_MATCHES_ALL).find(body)?.groupValues?.get(1)?.let(::xmlUnescape).orEmpty()
      val inline = Regex("<t\\b[^>]*>(.*?)</t>", RegexOption.DOT_MATCHES_ALL).findAll(body).joinToString("") { xmlUnescape(stripXml(it.groupValues[1])) }
      val formula = Regex("<f\\b[^>]*>(.*?)</f>", RegexOption.DOT_MATCHES_ALL).find(body)?.groupValues?.get(1)?.let(::stripXml)
      val value = when (type) {
        "s" -> shared.getOrNull(raw.toIntOrNull() ?: -1).orEmpty()
        "inlineStr" -> inline
        "b" -> if (raw == "1") "TRUE" else "FALSE"
        "str" -> raw
        else -> if (raw.isNotEmpty()) formatXlsxNumber(raw, styles.getOrNull(style)?.formatId ?: 0) else formula?.let { "=$it" }.orEmpty()
      }
      cells[row to column] = XlsxCell(value, style, type !in setOf("s", "inlineStr", "str", "b") && raw.toDoubleOrNull() != null)
    }
    if (cells.isEmpty()) return "<div class=\"empty-sheet\">This worksheet has no visible cells.</div>"
    val rowCount = (cells.keys.maxOf { it.first } + 1).coerceAtMost(maxRows)
    val columnCount = (cells.keys.maxOf { it.second } + 1).coerceAtMost(maxColumns)
    val merged = mutableMapOf<Pair<Int, Int>, Pair<Int, Int>>()
    val covered = mutableSetOf<Pair<Int, Int>>()
    Regex("<mergeCell\\b[^>]*ref=\"([^\"]+)\"[^>]*/?>").findAll(xml).forEach { match ->
      val range = match.groupValues[1].split(":")
      val start = cellLocation(range.firstOrNull().orEmpty()) ?: return@forEach
      val end = cellLocation(range.lastOrNull().orEmpty()) ?: return@forEach
      if (start.first >= rowCount || start.second >= columnCount) return@forEach
      val rowSpan = (end.first - start.first + 1).coerceAtLeast(1)
      val colSpan = (end.second - start.second + 1).coerceAtLeast(1)
      merged[start] = rowSpan to colSpan
      for (row in start.first..end.first) for (column in start.second..end.second) if (row != start.first || column != start.second) covered.add(row to column)
    }
    val widths = readColumnWidths(xml, columnCount)
    val out = StringBuilder("<table class=\"grid\"><colgroup><col style=\"width:38px\">")
    for (column in 0 until columnCount) out.append("<col style=\"width:${widths[column]}px\">")
    out.append("</colgroup><thead><tr><th></th>")
    for (column in 0 until columnCount) out.append("<th>${columnName(column)}</th>")
    out.append("</tr></thead><tbody>")
    for (row in 0 until rowCount) {
      out.append("<tr><th class=\"row-head\">${row + 1}</th>")
      for (column in 0 until columnCount) {
        val key = row to column
        if (covered.contains(key)) continue
        val cell = cells[key]
        val merge = merged[key]
        val visual = styles.getOrNull(cell?.style ?: 0) ?: XlsxStyle(null, null, false, false, 0)
        val style = buildString {
          if (visual.fill != null) append("background:${visual.fill};")
          if (visual.color != null) append("color:${visual.color};")
          if (visual.bold) append("font-weight:700;")
          if (visual.italic) append("font-style:italic;")
        }
        val spans = buildString { merge?.let { append(" rowspan=\"${it.first}\" colspan=\"${it.second}\"") } }
        out.append("<td$spans class=\"${if (cell?.numeric == true) "number" else ""}\" style=\"$style\">${escapeHtml(cell?.value.orEmpty())}</td>")
      }
      out.append("</tr>")
    }
    out.append("</tbody></table>")
    if (rowCount == maxRows || columnCount == maxColumns) out.append("<div class=\"note\">Showing the first ${rowCount} rows and ${columnCount} columns.</div>")
    return out.toString()
  }

  private fun readSharedStrings(zip: ZipFile): List<String> {
    val xml = readZipText(zip, "xl/sharedStrings.xml") ?: return emptyList()
    return Regex("<si\\b[^>]*>(.*?)</si>", RegexOption.DOT_MATCHES_ALL).findAll(xml).map { entry ->
      Regex("<t\\b[^>]*>(.*?)</t>", RegexOption.DOT_MATCHES_ALL).findAll(entry.groupValues[1]).joinToString("") { xmlUnescape(stripXml(it.groupValues[1])) }
    }.toList()
  }

  private fun readXlsxStyles(zip: ZipFile): List<XlsxStyle> {
    val xml = readZipText(zip, "xl/styles.xml") ?: return listOf(XlsxStyle(null, null, false, false, 0))
    val fonts = Regex("<fonts\\b[^>]*>(.*?)</fonts>", RegexOption.DOT_MATCHES_ALL).find(xml)?.groupValues?.get(1)?.let { section ->
      Regex("<font\\b[^>]*>(.*?)</font>", RegexOption.DOT_MATCHES_ALL).findAll(section).map { font ->
        val body = font.groupValues[1]
        Triple(colorFromXml(body), body.contains("<b"), body.contains("<i"))
      }.toList()
    }.orEmpty()
    val fills = Regex("<fills\\b[^>]*>(.*?)</fills>", RegexOption.DOT_MATCHES_ALL).find(xml)?.groupValues?.get(1)?.let { section ->
      Regex("<fill\\b[^>]*>(.*?)</fill>", RegexOption.DOT_MATCHES_ALL).findAll(section).map { colorFromXml(it.groupValues[1]) }.toList()
    }.orEmpty()
    val xfs = Regex("<cellXfs\\b[^>]*>(.*?)</cellXfs>", RegexOption.DOT_MATCHES_ALL).find(xml)?.groupValues?.get(1).orEmpty()
    val result = Regex("<xf\\b([^>]*)/?>").findAll(xfs).map { xf ->
      val attrs = xf.groupValues[1]
      val font = fonts.getOrNull(attribute(attrs, "fontId")?.toIntOrNull() ?: 0)
      XlsxStyle(fills.getOrNull(attribute(attrs, "fillId")?.toIntOrNull() ?: 0), font?.first, font?.second == true, font?.third == true, attribute(attrs, "numFmtId")?.toIntOrNull() ?: 0)
    }.toList()
    return if (result.isEmpty()) listOf(XlsxStyle(null, null, false, false, 0)) else result
  }

  private fun readColumnWidths(xml: String, count: Int): IntArray {
    val widths = IntArray(count) { 88 }
    Regex("<col\\b([^>]*)/?>").findAll(xml).forEach { column ->
      val attrs = column.groupValues[1]
      val start = (attribute(attrs, "min")?.toIntOrNull() ?: 1) - 1
      val end = (attribute(attrs, "max")?.toIntOrNull() ?: start + 1) - 1
      val width = (((attribute(attrs, "width")?.toDoubleOrNull() ?: 12.0) * 7.0) + 5.0).toInt().coerceIn(42, 360)
      for (index in start..minOf(end, count - 1)) if (index >= 0) widths[index] = width
    }
    return widths
  }

  private fun readRelationships(zip: ZipFile, sourceName: String): Map<String, String> {
    val relationsPath = sourceName.substringBeforeLast('/') + "/_rels/" + sourceName.substringAfterLast('/') + ".rels"
    val xml = readZipText(zip, relationsPath) ?: return emptyMap()
    return Regex("<Relationship\\b[^>]*Id=\"([^\"]+)\"[^>]*Target=\"([^\"]+)\"", RegexOption.DOT_MATCHES_ALL)
      .findAll(xml)
      .associate { it.groupValues[1] to it.groupValues[2] }
  }

  private fun normalizeZipPath(path: String): String {
    val parts = ArrayDeque<String>()
    path.replace('\\', '/').split('/').forEach { part ->
      when (part) {
        "", "." -> Unit
        ".." -> if (parts.isNotEmpty()) parts.removeLast()
        else -> parts.addLast(part)
      }
    }
    return parts.joinToString("/")
  }

  private fun cellLocation(reference: String): Pair<Int, Int>? {
    val match = Regex("([A-Z]+)(\\d+)", RegexOption.IGNORE_CASE).matchEntire(reference) ?: return null
    var column = 0
    match.groupValues[1].uppercase(Locale.US).forEach { column = (column * 26) + (it.code - 'A'.code + 1) }
    return (match.groupValues[2].toIntOrNull()?.minus(1) ?: return null) to (column - 1)
  }

  private fun columnName(index: Int): String { var value = index + 1; val out = StringBuilder(); while (value > 0) { val remainder = (value - 1) % 26; out.append(('A'.code + remainder).toChar()); value = (value - 1) / 26 }; return out.reverse().toString() }
  private fun attribute(attrs: String, name: String): String? = Regex("${Regex.escape(name)}=\\\"([^\\\"]*)\\\"").find(attrs)?.groupValues?.get(1)
  private fun readZipText(zip: ZipFile, name: String): String? = zip.getEntry(name)?.let { zip.getInputStream(it).bufferedReader().readText() }
  private fun colorFromXml(xml: String): String? = Regex("(?:rgb|lastClr)=\\\"([0-9A-Fa-f]{6,8})\\\"").find(xml)?.groupValues?.get(1)?.let { value -> "#${if (value.length == 8) value.substring(2) else value}" }
  private fun formatXlsxNumber(raw: String, formatId: Int): String {
    val number = raw.toDoubleOrNull() ?: return raw
    if (formatId in 14..22) { val calendar = Calendar.getInstance(); calendar.timeInMillis = ((number - 25569) * 86400000.0).toLong(); return java.text.SimpleDateFormat(if (formatId in 18..21) "HH:mm" else "yyyy-MM-dd", Locale.US).format(calendar.time) }
    return when {
      formatId in setOf(9, 10) -> DecimalFormat(if (formatId == 10) "0.00%" else "0%").format(number)
      number % 1.0 == 0.0 -> DecimalFormat("#,##0").format(number)
      else -> DecimalFormat("#,##0.##").format(number)
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
