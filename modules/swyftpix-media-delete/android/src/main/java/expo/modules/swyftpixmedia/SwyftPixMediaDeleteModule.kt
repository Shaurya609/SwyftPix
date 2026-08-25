package expo.modules.swyftpixmedia

import android.app.Activity
import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.provider.Settings
import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream

class SwyftPixMediaDeleteModule : Module() {
  companion object {
    private const val TAG = "SwyftPixMediaDelete"
    private const val DELETE_REQUEST_CODE = 47261
    private val PROTECTED_PATH_PREFIXES = listOf("Android/data/", "Android/obb/")
  }

  private var pendingPromise: Promise? = null

  private val context: Context
    get() = appContext.reactContext ?: error("React context is unavailable")

  override fun definition() = ModuleDefinition {
    Name("SwyftPixMediaDelete")

    Function("canManageMedia") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return@Function false
      MediaStore.canManageMedia(context)
    }

    Function("requestMediaManagementAccess") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return@Function false
      val activity = appContext.activityProvider?.currentActivity ?: return@Function false
      try {
        val intent = Intent(Settings.ACTION_REQUEST_MANAGE_MEDIA, Uri.parse("package:${context.packageName}"))
        activity.startActivity(intent)
        true
      } catch (error: Exception) {
        Log.e(TAG, "Could not open Media management settings", error)
        false
      }
    }

    Function("hasAllFilesAccess") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) Environment.isExternalStorageManager() else true
    }

    Function("requestAllFilesAccess") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return@Function true
      val activity = appContext.activityProvider?.currentActivity ?: return@Function false
      try {
        val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:${context.packageName}"))
        activity.startActivity(intent)
        true
      } catch (error: Exception) {
        Log.e(TAG, "Could not open All Files Access settings", error)
        false
      }
    }

    Function("listSharedFiles") { category: String, limit: Int ->
      listSharedFiles(category, limit.coerceIn(1, 200))
    }

    AsyncFunction("renderPdfPage") { uriString: String, pageIndex: Int, maxWidth: Int ->
      renderPdfPage(uriString, pageIndex, maxWidth.coerceIn(320, 1800))
    }

    AsyncFunction("getPdfPageCount") { uriString: String ->
      getPdfPageCount(uriString)
    }

    AsyncFunction("deleteMediaByPath") { path: String, promise: Promise ->
      if (pendingPromise != null) {
        promise.reject("E_DELETE_BUSY", "Another media deletion is awaiting Android authorization.", null)
        return@AsyncFunction
      }
      Log.d(TAG, "deleteMediaByPath input=$path")
      val mediaUri = findMediaUri(path)
      if (mediaUri == null) {
        Log.w(TAG, "Refusing deletion: file is outside SwyftPix's safe user-file scope")
        promise.resolve(false)
        return@AsyncFunction
      }
      val resolver = context.contentResolver
      try {
        val deleted = resolver.delete(mediaUri, null, null)
        if (deleted > 0) {
          promise.resolve(true)
          return@AsyncFunction
        }
      } catch (error: SecurityException) {
        Log.w(TAG, "Direct MediaStore delete requires authorization", error)
      } catch (error: Exception) {
        Log.w(TAG, "Direct MediaStore delete failed", error)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        val activity = appContext.activityProvider?.currentActivity
        if (activity == null) {
          promise.reject("E_NO_ACTIVITY", "No foreground Android activity is available for media deletion authorization.", null)
          return@AsyncFunction
        }
        try {
          val request = MediaStore.createDeleteRequest(resolver, listOf(mediaUri))
          pendingPromise = promise
          activity.startIntentSenderForResult(request.intentSender, DELETE_REQUEST_CODE, null, 0, 0, 0)
          return@AsyncFunction
        } catch (error: Exception) {
          pendingPromise = null
          promise.reject("E_DELETE_REQUEST", "Could not start Android media deletion authorization.", error)
          return@AsyncFunction
        }
      }
      promise.resolve(false)
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != DELETE_REQUEST_CODE) return@OnActivityResult
      val promise = pendingPromise
      pendingPromise = null
      promise?.resolve(payload.resultCode == Activity.RESULT_OK)
    }
  }

  private fun renderPdfPage(uriString: String, pageIndex: Int, maxWidth: Int): String? {
    if (!uriString.startsWith("content://")) return null
    return try {
      context.contentResolver.openFileDescriptor(Uri.parse(uriString), "r")?.use { descriptor ->
        PdfRenderer(descriptor).use { renderer ->
          if (pageIndex !in 0 until renderer.pageCount) return null
          renderer.openPage(pageIndex).use { page ->
            val scale = maxWidth.toFloat() / page.width.toFloat()
            val width = maxOf(1, (page.width * scale).toInt())
            val height = maxOf(1, (page.height * scale).toInt())
            val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
            bitmap.eraseColor(android.graphics.Color.WHITE)
            page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)

            val cacheDir = File(context.cacheDir, "pdf-previews")
            if (!cacheDir.exists()) cacheDir.mkdirs()
            val safeName = "${uriString.hashCode().toUInt().toString(16)}_${pageIndex}_${width}.png"
            val output = File(cacheDir, safeName)
            FileOutputStream(output).use { stream ->
              bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)
            }
            bitmap.recycle()
            output.toURI().toString()
          }
        }
      }
    } catch (error: Exception) {
      Log.w(TAG, "PDF page rendering failed for page=$pageIndex", error)
      null
    }
  }

  private fun getPdfPageCount(uriString: String): Int {
    if (!uriString.startsWith("content://")) return 0
    return try {
      context.contentResolver.openFileDescriptor(Uri.parse(uriString), "r")?.use { descriptor ->
        PdfRenderer(descriptor).use { it.pageCount }
      } ?: 0
    } catch (error: Exception) {
      Log.w(TAG, "PDF page count failed", error)
      0
    }
  }

  private fun isProtectedRelativePath(relativePath: String): Boolean {
    val normalized = relativePath.replace('\\', '/').removePrefix("/")
    if (normalized.equals("Android", true)) return true
    return PROTECTED_PATH_PREFIXES.any { prefix -> normalized.equals(prefix.removeSuffix("/"), true) || normalized.startsWith(prefix, true) }
  }

  private fun isSafeSharedFile(relativePath: String, fileName: String): Boolean {
    if (fileName.isBlank() || fileName.startsWith(".")) return false
    val normalized = relativePath.replace('\\', '/').removePrefix("/")
    if (normalized.contains("../") || normalized == "..") return false
    if (isProtectedRelativePath(normalized)) return false
    return true
  }

  private fun listSharedFiles(category: String, limit: Int): List<Bundle> {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && !Environment.isExternalStorageManager()) {
      Log.d(TAG, "listSharedFiles skipped: All Files Access is not granted")
      return emptyList()
    }

    val collection = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY) else MediaStore.Files.getContentUri("external")
    val projection = arrayOf(
      MediaStore.Files.FileColumns._ID,
      MediaStore.Files.FileColumns.DISPLAY_NAME,
      MediaStore.Files.FileColumns.MIME_TYPE,
      MediaStore.Files.FileColumns.SIZE,
      MediaStore.Files.FileColumns.DATE_MODIFIED,
      MediaStore.Files.FileColumns.RELATIVE_PATH,
      MediaStore.Files.FileColumns.MEDIA_TYPE
    )
    val results = mutableListOf<Bundle>()
    val seen = mutableSetOf<String>()
    try {
      context.contentResolver.query(collection, projection, null, null, "${MediaStore.Files.FileColumns.DATE_MODIFIED} DESC")?.use { cursor ->
        val idIndex = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID)
        val nameIndex = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DISPLAY_NAME)
        val mimeIndex = cursor.getColumnIndex(MediaStore.Files.FileColumns.MIME_TYPE)
        val sizeIndex = cursor.getColumnIndex(MediaStore.Files.FileColumns.SIZE)
        val modifiedIndex = cursor.getColumnIndex(MediaStore.Files.FileColumns.DATE_MODIFIED)
        val relativeIndex = cursor.getColumnIndex(MediaStore.Files.FileColumns.RELATIVE_PATH)
        val mediaTypeIndex = cursor.getColumnIndex(MediaStore.Files.FileColumns.MEDIA_TYPE)

        while (cursor.moveToNext() && results.size < limit) {
          val mediaType = if (mediaTypeIndex >= 0) cursor.getInt(mediaTypeIndex) else MediaStore.Files.FileColumns.MEDIA_TYPE_NONE
          if (mediaType != MediaStore.Files.FileColumns.MEDIA_TYPE_NONE && mediaType != MediaStore.Files.FileColumns.MEDIA_TYPE_DOCUMENT) continue

          val name = cursor.getString(nameIndex) ?: continue
          val relativePath = if (relativeIndex >= 0 && !cursor.isNull(relativeIndex)) cursor.getString(relativeIndex) else ""
          if (!isSafeSharedFile(relativePath, name)) continue

          val mimeType = if (mimeIndex >= 0 && !cursor.isNull(mimeIndex)) cursor.getString(mimeIndex) else "application/octet-stream"
          val fileCategory = classifyFile(name, mimeType)
          if (category == "all" && fileCategory == "other") continue
          if (category != "all" && fileCategory != category) continue

          val id = cursor.getLong(idIndex)
          val uri = ContentUris.withAppendedId(collection, id).toString()
          if (!seen.add(uri)) continue

          val size = if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) cursor.getLong(sizeIndex) else 0L
          val modifiedSeconds = if (modifiedIndex >= 0 && !cursor.isNull(modifiedIndex)) cursor.getLong(modifiedIndex) else 0L
          results.add(Bundle().apply {
            putString("id", "file:$id")
            putString("fileName", name)
            putString("fileType", fileCategory)
            putString("mimeType", mimeType)
            putLong("fileSize", size.coerceAtLeast(0L))
            putLong("dateModified", modifiedSeconds)
            putString("relativePath", relativePath)
            putString("uri", uri)
          })
        }
      }
    } catch (error: Exception) {
      Log.w(TAG, "Shared non-media file query failed", error)
    }
    Log.d(TAG, "listSharedFiles category=$category count=${results.size}")
    return results
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

  private fun relativePathFor(path: String): String {
    val normalized = path.replace('\\', '/')
    val externalRoot = "/storage/emulated/0/"

    return if (normalized.startsWith(externalRoot)) {
      normalized.removePrefix(externalRoot)
        .substringBeforeLast('/', "")
        .let { if (it.isEmpty()) "" else "$it/" }
    } else {
      normalized.substringBeforeLast('/', "")
        .removePrefix("/")
        .let { if (it.isEmpty()) "" else "$it/" }
    }
  }

  private fun findInCollection(
    resolver: android.content.ContentResolver,
    collection: Uri,
    category: String,
    fileName: String,
    relativePath: String
  ): Uri? {
    return try {
      val projection = arrayOf(
        MediaStore.MediaColumns._ID,
        MediaStore.MediaColumns.DISPLAY_NAME,
        MediaStore.MediaColumns.RELATIVE_PATH
      )

      val selection =
        "${MediaStore.MediaColumns.DISPLAY_NAME} = ? AND " +
        "${MediaStore.MediaColumns.RELATIVE_PATH} = ?"

      resolver.query(
        collection,
        projection,
        selection,
        arrayOf(fileName, relativePath),
        null
      )?.use { cursor ->
        if (!cursor.moveToFirst()) return@use null

        val name = cursor.getString(
          cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME)
        )
        val storedRelativePath = cursor.getString(
          cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.RELATIVE_PATH)
        )

        if (!isSafeSharedFile(storedRelativePath, name)) return@use null

        ContentUris.withAppendedId(
          collection,
          cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID))
        )
      }
    } catch (error: Exception) {
      Log.w(TAG, "Safe $category MediaStore lookup failed", error)
      null
    }
  }

  private fun findMediaUri(rawPath: String): Uri? {
    if (rawPath.startsWith("content://")) return validateContentUri(Uri.parse(rawPath))
    val targetPath = Uri.parse(rawPath).path ?: rawPath
    val fileName = targetPath.substringAfterLast('/')
    val relativePath = relativePathFor(targetPath)
    if (!isSafeSharedFile(relativePath, fileName)) return null
    val resolver = context.contentResolver
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      findInCollection(resolver, MediaStore.Images.Media.EXTERNAL_CONTENT_URI, "images", fileName, relativePath)?.let { return it }
      findInCollection(resolver, MediaStore.Video.Media.EXTERNAL_CONTENT_URI, "videos", fileName, relativePath)?.let { return it }
      findInCollection(resolver, MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, "audio", fileName, relativePath)?.let { return it }
    }
    val collection = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY) else MediaStore.Files.getContentUri("external")
    return try {
      resolver.query(collection, arrayOf(MediaStore.Files.FileColumns._ID, MediaStore.Files.FileColumns.DISPLAY_NAME, MediaStore.Files.FileColumns.RELATIVE_PATH), "${MediaStore.Files.FileColumns.DISPLAY_NAME} = ? AND ${MediaStore.Files.FileColumns.RELATIVE_PATH} = ?", arrayOf(fileName, relativePath), null)?.use { cursor ->
        if (!cursor.moveToFirst()) return@use null
        val name = cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DISPLAY_NAME))
        val storedRelativePath = cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.RELATIVE_PATH))
        if (!isSafeSharedFile(storedRelativePath, name)) return@use null
        ContentUris.withAppendedId(collection, cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID)))
      }
    } catch (error: Exception) {
      Log.w(TAG, "safe MediaStore file lookup failed", error)
      null
    }
  }

  private fun validateContentUri(uri: Uri): Uri? {
    if (uri.scheme != "content" || uri.authority != "media") return null
    val resolver = context.contentResolver
    return try {
      resolver.query(uri, arrayOf(MediaStore.Files.FileColumns.DISPLAY_NAME, MediaStore.Files.FileColumns.RELATIVE_PATH, MediaStore.Files.FileColumns.MEDIA_TYPE), null, null, null)?.use { cursor ->
        if (!cursor.moveToFirst()) return@use null
        val name = cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DISPLAY_NAME))
        val relativePath = cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.RELATIVE_PATH))
        val mediaType = cursor.getInt(cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.MEDIA_TYPE))
        if (!isSafeSharedFile(relativePath, name)) return@use null
        if (mediaType != MediaStore.Files.FileColumns.MEDIA_TYPE_NONE && isProtectedRelativePath(relativePath)) return@use null
        uri
      }
    } catch (error: Exception) {
      Log.w(TAG, "content URI safety validation failed", error)
      null
    }
  }

}