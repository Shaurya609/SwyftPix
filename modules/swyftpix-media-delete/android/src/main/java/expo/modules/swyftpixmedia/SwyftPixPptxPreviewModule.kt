package expo.modules.swyftpixmedia

import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.zip.ZipFile

class SwyftPixPptxPreviewModule : Module() {
  private val context get() = appContext.reactContext ?: error("React context unavailable")

  override fun definition() = ModuleDefinition {
    Name("SwyftPixPptxPreview")
    View(SwyftPixPptxPreviewView::class) {
      Prop("html") { view: SwyftPixPptxPreviewView, html: String? -> view.loadHtml(html.orEmpty()) }
    }
    AsyncFunction("renderPptxHtml") { uriString: String -> renderPptxHtml(uriString) }
  }

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
    val slides = zip.entries().asSequence()
      .filter { !it.isDirectory && it.name.matches(Regex("ppt/slides/slide\\d+\\.xml")) }
      .sortedBy { Regex("slide(\\d+)\\.xml").find(it.name)?.groupValues?.get(1)?.toIntOrNull() ?: 0 }
      .mapNotNull { entry ->
        val xml = zip.getInputStream(entry).bufferedReader().readText()
        val texts = Regex("<a:t\\b[^>]*>(.*?)</a:t>", setOf(RegexOption.DOT_MATCHES_ALL)).findAll(xml)
          .map { xmlUnescape(it.groupValues[1]) }.filter { it.isNotBlank() }.toList()
        if (texts.isEmpty()) null else texts
      }.toList()
    if (slides.isEmpty()) return ""

    val out = StringBuilder()
    slides.forEachIndexed { index, texts ->
      out.append("<section class=\"slide\"><div class=\"slideNumber\">${index + 1}</div>")
      texts.forEachIndexed { textIndex, text ->
        val cls = when {
          textIndex == 0 -> "title"
          text.length > 120 -> "body small"
          else -> "body"
        }
        out.append("<div class=\"$cls\">").append(escapeHtml(text)).append("</div>")
      }
      out.append("</section>")
    }
    return """
      <!doctype html><html><head>
      <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes" />
      <style>
      *{box-sizing:border-box}html,body{margin:0;padding:0;background:#252525;color:#171717;font-family:Arial,Helvetica,sans-serif}
      body{padding:16px 0 30px}.slide{position:relative;width:min(960px,calc(100vw - 24px));aspect-ratio:16/9;margin:0 auto 20px;background:#fff;padding:8% 9%;box-shadow:0 2px 12px rgba(0,0,0,.35);overflow:hidden}
      .title{font-size:clamp(24px,4.2vw,48px);font-weight:800;line-height:1.12;margin-bottom:6%}.body{font-size:clamp(15px,2.1vw,25px);line-height:1.4;margin:10px 0;white-space:pre-wrap}.small{font-size:clamp(12px,1.6vw,19px)}
      .slideNumber{position:absolute;right:18px;bottom:12px;color:#777;font-size:12px}
      @media(max-width:600px){body{padding:8px 0 20px}.slide{width:calc(100vw - 12px);margin-bottom:12px;padding:8% 7%}}
      </style></head><body>$out</body></html>
    """.trimIndent()
  }

  private fun xmlUnescape(value: String): String = value
    .replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    .replace("&quot;", "\"").replace("&apos;", "'")

  private fun escapeHtml(value: String): String = value
    .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    .replace("\"", "&quot;").replace("'", "&#39;")
}
