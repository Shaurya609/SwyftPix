package expo.modules.swyftpixmedia

import android.graphics.Color
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

class SwyftPixPptxPreviewView(context: android.content.Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val webView = WebView(context)

  init {
    setBackgroundColor(Color.rgb(236, 236, 236))
    webView.setBackgroundColor(Color.rgb(236, 236, 236))
    webView.layoutParams = FrameLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    webView.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = true
      builtInZoomControls = true
      displayZoomControls = false
      loadWithOverviewMode = false
      useWideViewPort = true
      defaultTextEncodingName = "UTF-8"
    }
    webView.webViewClient = WebViewClient()
    addView(webView)
  }

  fun loadHtml(html: String) {
    webView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null)
  }
}
