package expo.modules.swyftpixmedia

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SwyftPixFileAccessModule : Module() {
  companion object {
    private const val TAG = "SwyftPixFileAccess"
    private const val REQUEST_PICK_TREE = 58121
    private const val REQUEST_PICK_FILES = 58122
    private const val PREFS_NAME = "swyftpix_file_access"
    private const val PREFS_URIS = "persisted_uris"
    private const val MAX_DEPTH = 8
    private const val DEFAULT_LIMIT = 200
    private val PROTECTED_SEGMENTS = setOf("android", "android/data", "android/obb")
  }

  private var pendingPromise: Promise? = null

  private val context: Context
    get() = appContext.reactContext ?: error("React context is unavailable")

  override fun definition() = ModuleDefinition {
    Name("SwyftPixFileAccess")

    Function("hasAccess") {
      pruneInvalidPermissions()
      storedUris().isNotEmpty()
    }

    AsyncFunction("pickDirectory") { promise: Promise ->
      launchPicker(Intent.ACTION_OPEN_DOCUMENT_TREE, REQUEST_PICK_TREE, promise)
    }

    AsyncFunction("pickFiles") { promise: Promise ->
      launchPicker(Intent.ACTION_OPEN_DOCUMENT, REQUEST_PICK_FILES, promise)
    }

    Function("listFiles") { category: String, limit: Int ->
      listFiles(category, limit.coerceIn(1, DEFAULT_LIMIT))
    }

    AsyncFunction("deleteFile") { uriString: String, promise: Promise ->
      val uri = try { Uri.parse(uriString) } catch (_: Exception) { null }
      if (uri == null || !isStoredUri(uri)) {
        promise.resolve(false)
        return@AsyncFunction
      }
      try {
        promise.resolve(DocumentsContract.deleteDocument(context.contentResolver, uri))
      } catch (error: Exception) {
        Log.w(TAG, "SAF delete failed", error)
        promise.resolve(false)
      }
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != REQUEST_PICK_TREE && payload.requestCode != REQUEST_PICK_FILES) return@OnActivityResult
      val promise = pendingPromise
      pendingPromise = null
      if (promise == null) return@OnActivityResult
      if (payload.resultCode != Activity.RESULT_OK || payload.data == null) {
        promise.resolve(false)
        return@OnActivityResult
      }

      val data = payload.data
      val takeFlags = data.flags and (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
      val uris = mutableListOf<Uri>()
      data.data?.let { uris.add(it) }
      data.clipData?.let { clip ->
        for (index in 0 until clip.itemCount) uris.add(clip.getItemAt(index).uri)
      }

      var accepted = 0
      for (uri in uris.distinct()) {
        try {
          val safe = if (payload.requestCode == REQUEST_PICK_TREE) isSafeTreeUri(uri) else isSafeDocumentUri(uri)
          if (!safe) continue
          if (takeFlags != 0) context.contentResolver.takePersistableUriPermission(uri, takeFlags)
          addStoredUri(uri)
          accepted++
        } catch (error: Exception) {
          Log.w(TAG, "Could not persist SAF permission for $uri", error)
        }
      }
      promise.resolve(accepted > 0)
    }
  }

  private fun launchPicker(action: String, requestCode: Int, promise: Promise) {
    if (pendingPromise != null) {
      promise.reject("E_FILE_ACCESS_BUSY", "Another Android file access request is already in progress.", null)
      return
    }
    if (requestCode == REQUEST_PICK_TREE && android.os.Build.VERSION.SDK_INT < 21) {
      promise.resolve(false)
      return
    }
    val activity = appContext.activityProvider?.currentActivity
    if (activity == null) {
      promise.reject("E_NO_ACTIVITY", "No foreground Android activity is available for file access.", null)
      return
    }
    try {
      val intent = Intent(action).apply {
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        if (action == Intent.ACTION_OPEN_DOCUMENT) {
          addCategory(Intent.CATEGORY_OPENABLE)
          type = "*/*"
          putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        }
      }
      pendingPromise = promise
      activity.startActivityForResult(intent, requestCode)
    } catch (error: Exception) {
      pendingPromise = null
      promise.reject("E_FILE_ACCESS_PICKER", "Could not open Android file picker.", error)
    }
  }

  private fun prefs() = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  private fun storedUris(): List<Uri> = prefs().getStringSet(PREFS_URIS, emptySet()).orEmpty().mapNotNull {
    try { Uri.parse(it) } catch (_: Exception) { null }
  }

  private fun addStoredUri(uri: Uri) {
    val values = prefs().getStringSet(PREFS_URIS, emptySet()).orEmpty().toMutableSet()
    values.add(uri.toString())
    prefs().edit().putStringSet(PREFS_URIS, values).apply()
  }

  private fun removeStoredUri(uri: Uri) {
    val values = prefs().getStringSet(PREFS_URIS, emptySet()).orEmpty().toMutableSet()
    values.remove(uri.toString())
    prefs().edit().putStringSet(PREFS_URIS, values).apply()
  }

  private fun isStoredUri(uri: Uri): Boolean {
    return storedUris().any { stored ->
      stored.toString() == uri.toString() || (DocumentsContract.isTreeUri(stored) && stored.authority == uri.authority)
    }
  }

  private fun pruneInvalidPermissions() {
    for (uri in storedUris()) {
      try {
        context.contentResolver.persistedUriPermissions.firstOrNull { it.uri == uri } ?: removeStoredUri(uri)
      } catch (_: Exception) {
        removeStoredUri(uri)
      }
    }
  }

  private fun isSafeTreeUri(uri: Uri): Boolean {
    if (!DocumentsContract.isTreeUri(uri)) return false
    val docId = try { DocumentsContract.getTreeDocumentId(uri) } catch (_: Exception) { return false }
    return isSafeExternalDocumentId(uri, docId)
  }

  private fun isSafeDocumentUri(uri: Uri): Boolean {
    if (uri.scheme != "content") return false
    val docId = try { DocumentsContract.getDocumentId(uri) } catch (_: Exception) { return false }
    return isSafeExternalDocumentId(uri, docId)
  }

  private fun isSafeExternalDocumentId(uri: Uri, documentId: String): Boolean {
    if (uri.authority != "com.android.externalstorage.documents") return true
    val path = documentId.substringAfter(':', documentId).replace('\\', '/').trim('/')
    if (path.isBlank()) return false
    val lower = path.lowercase()
    return PROTECTED_SEGMENTS.none { lower == it || lower.startsWith("$it/") }
  }

  private fun listFiles(category: String, limit: Int): List<Bundle> {
    pruneInvalidPermissions()
    val results = mutableListOf<Bundle>()
    val seen = mutableSetOf<String>()
    for (uri in storedUris()) {
      if (results.size >= limit) break
      if (DocumentsContract.isTreeUri(uri)) {
        scanTree(uri, category, limit, results, seen, 0)
      } else {
        querySingleDocument(uri, category)?.let { file ->
          val key = file.getString("uri") ?: return@let
          if (seen.add(key)) results.add(file)
        }
      }
    }
    Log.d(TAG, "listFiles category=$category count=${results.size}")
    return results
  }

  private fun scanTree(treeUri: Uri, category: String, limit: Int, results: MutableList<Bundle>, seen: MutableSet<String>, depth: Int) {
    if (results.size >= limit || depth > MAX_DEPTH) return
    val treeDocumentId = try { DocumentsContract.getTreeDocumentId(treeUri) } catch (_: Exception) { return }
    if (!isSafeExternalDocumentId(treeUri, treeDocumentId)) return
    val childrenUri = try { DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, treeDocumentId) } catch (_: Exception) { return }
    val projection = arrayOf(
      DocumentsContract.Document.COLUMN_DOCUMENT_ID,
      DocumentsContract.Document.COLUMN_DISPLAY_NAME,
      DocumentsContract.Document.COLUMN_MIME_TYPE,
      DocumentsContract.Document.COLUMN_SIZE,
      DocumentsContract.Document.COLUMN_LAST_MODIFIED,
      DocumentsContract.Document.COLUMN_FLAGS
    )
    try {
      context.contentResolver.query(childrenUri, projection, null, null, null)?.use { cursor ->
        val idIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
        val nameIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
        val mimeIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE)
        val sizeIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_SIZE)
        val modifiedIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED)
        val flagsIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_FLAGS)
        while (cursor.moveToNext() && results.size < limit) {
          if (idIndex < 0 || nameIndex < 0 || mimeIndex < 0) continue
          val documentId = cursor.getString(idIndex) ?: continue
          val name = cursor.getString(nameIndex) ?: continue
          val mime = cursor.getString(mimeIndex) ?: "application/octet-stream"
          if (name.startsWith(".")) continue
          if (!isSafeExternalDocumentId(treeUri, documentId)) continue
          if (mime == DocumentsContract.Document.MIME_TYPE_DIR) {
            if (name.equals("Android", true)) continue
            val childTree = DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId)
            scanTree(childTree, category, limit, results, seen, depth + 1)
            continue
          }
          val fileCategory = classifyFile(name, mime)
          if (category != "all" && fileCategory != category) continue
          val documentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId)
          val key = documentUri.toString()
          if (!seen.add(key)) continue
          results.add(Bundle().apply {
            putString("id", "saf:$key")
            putString("fileName", name)
            putString("fileType", fileCategory)
            putString("mimeType", mime)
            putLong("fileSize", if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) cursor.getLong(sizeIndex).coerceAtLeast(0L) else 0L)
            putLong("dateModified", if (modifiedIndex >= 0 && !cursor.isNull(modifiedIndex)) cursor.getLong(modifiedIndex).coerceAtLeast(0L) else 0L)
            putString("relativePath", "SAF")
            putString("uri", key)
            putBoolean("canDelete", flagsIndex < 0 || (cursor.getInt(flagsIndex) and DocumentsContract.Document.FLAG_SUPPORTS_DELETE) != 0)
          })
        }
      }
    } catch (error: Exception) {
      Log.w(TAG, "SAF tree scan failed for $treeUri", error)
    }
  }

  private fun querySingleDocument(uri: Uri, category: String): Bundle? {
    if (!isSafeDocumentUri(uri)) return null
    val projection = arrayOf(
      DocumentsContract.Document.COLUMN_DISPLAY_NAME,
      DocumentsContract.Document.COLUMN_MIME_TYPE,
      DocumentsContract.Document.COLUMN_SIZE,
      DocumentsContract.Document.COLUMN_LAST_MODIFIED,
      DocumentsContract.Document.COLUMN_FLAGS
    )
    return try {
      context.contentResolver.query(uri, projection, null, null, null)?.use { cursor ->
        if (!cursor.moveToFirst()) return@use null
        val name = cursor.getString(cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME)) ?: return@use null
        val mime = cursor.getString(cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_MIME_TYPE)) ?: "application/octet-stream"
        if (mime == DocumentsContract.Document.MIME_TYPE_DIR || name.startsWith(".")) return@use null
        val fileCategory = classifyFile(name, mime)
        if (category != "all" && fileCategory != category) return@use null
        val sizeIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_SIZE)
        val modifiedIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED)
        val flagsIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_FLAGS)
        Bundle().apply {
          putString("id", "saf:${uri}")
          putString("fileName", name)
          putString("fileType", fileCategory)
          putString("mimeType", mime)
          putLong("fileSize", if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) cursor.getLong(sizeIndex).coerceAtLeast(0L) else 0L)
          putLong("dateModified", if (modifiedIndex >= 0 && !cursor.isNull(modifiedIndex)) cursor.getLong(modifiedIndex).coerceAtLeast(0L) else 0L)
          putString("relativePath", "SAF")
          putString("uri", uri.toString())
          putBoolean("canDelete", flagsIndex < 0 || (cursor.getInt(flagsIndex) and DocumentsContract.Document.FLAG_SUPPORTS_DELETE) != 0)
        }
      }
    } catch (error: Exception) {
      Log.w(TAG, "SAF document query failed for $uri", error)
      null
    }
  }

  private fun classifyFile(fileName: String, mimeType: String): String {
    val extension = fileName.substringAfterLast('.', "").lowercase()
    return when (extension) {
      "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "rtf", "odt", "ods", "odp", "epub" -> "document"
      "zip", "rar", "7z", "tar", "gz", "bz2", "xz", "tgz" -> "archive"
      "apk", "xapk", "apks", "aab" -> "apk"
      else -> if (mimeType.startsWith("text/") || mimeType.contains("pdf") || mimeType.contains("document") || mimeType.contains("spreadsheet") || mimeType.contains("presentation")) "document" else "other"
    }
  }
}
