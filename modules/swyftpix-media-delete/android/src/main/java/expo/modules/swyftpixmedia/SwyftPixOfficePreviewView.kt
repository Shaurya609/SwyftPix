package expo.modules.swyftpixmedia

import android.content.Context
import android.graphics.Color
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/** Native in-app surface used to display the self-contained HTML produced by the Office renderer. */
class SwyftPixOfficePreviewView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val webView = WebView(context).apply {
    layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    setBackgroundColor(Color.TRANSPARENT)
    webViewClient = WebViewClient()
    settings.apply {
      javaScriptEnabled = false
      domStorageEnabled = false
      allowFileAccess = false
      allowContentAccess = false
      setSupportZoom(true)
      builtInZoomControls = false
      displayZoomControls = false
      loadWithOverviewMode = false
      useWideViewPort = false
      cacheMode = WebSettings.LOAD_NO_CACHE
    }
  }

  init {
    setBackgroundColor(Color.TRANSPARENT)
    addView(webView)
  }

  fun loadHtml(html: String) {
    webView.loadDataWithBaseURL(
      "https://swyftpix.local/",
      html,
      "text/html",
      "UTF-8",
      null
    )
  }

  override fun onDetachedFromWindow() {
    webView.stopLoading()
    webView.loadUrl("about:blank")
    super.onDetachedFromWindow()
  }
}
