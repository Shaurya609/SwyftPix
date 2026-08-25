package expo.modules.swyftpixmedia

import android.content.Context
import android.graphics.Color
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/** Native in-app surface used to display the self-contained HTML produced by the Office renderer. */
class SwyftPixOfficePreviewView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val webView = WebView(context).apply {
    layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    setBackgroundColor(Color.WHITE)
    webViewClient = WebViewClient()
    webChromeClient = WebChromeClient()
    settings.apply {
      javaScriptEnabled = false
      domStorageEnabled = false
      allowFileAccess = false
      allowContentAccess = false
      setSupportZoom(true)
      builtInZoomControls = false
      displayZoomControls = false
      loadWithOverviewMode = false
      useWideViewPort = true
      defaultTextEncodingName = "UTF-8"
      cacheMode = WebSettings.LOAD_NO_CACHE
    }
    isVerticalScrollBarEnabled = true
    isHorizontalScrollBarEnabled = false
    setInitialScale(0)
  }

  private var lastHtml: String? = null

  init {
    setBackgroundColor(Color.WHITE)
    isFocusable = true
    isClickable = true
    addView(webView)
  }

  fun loadHtml(html: String) {
    if (html == lastHtml) return
    lastHtml = html
    if (html.isBlank()) {
      webView.loadDataWithBaseURL(
        "https://swyftpix.local/",
        "<html><body style='margin:0;padding:24px;font-family:sans-serif'><h3>Document preview unavailable</h3><p>This DOCX could not be rendered.</p></body></html>",
        "text/html",
        "UTF-8",
        null
      )
      return
    }
    webView.loadDataWithBaseURL(
      "https://swyftpix.local/",
      html,
      "text/html",
      "UTF-8",
      null
    )
  }

  override fun onDetachedFromWindow() {
    lastHtml = null
    webView.stopLoading()
    webView.loadUrl("about:blank")
    super.onDetachedFromWindow()
  }
}
