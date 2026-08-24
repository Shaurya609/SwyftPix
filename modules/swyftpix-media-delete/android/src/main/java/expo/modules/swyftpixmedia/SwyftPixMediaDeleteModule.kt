package expo.modules.swyftpixmedia

import android.app.Activity
import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SwyftPixMediaDeleteModule : Module() {
  companion object {
    private const val TAG = "SwyftPixMediaDelete"
    private const val DELETE_REQUEST_CODE = 47261
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
        val intent = android.content.Intent(
          android.provider.Settings.ACTION_REQUEST_MANAGE_MEDIA,
          Uri.parse("package:${context.packageName}")
        )
        activity.startActivity(intent)
        true
      } catch (error: Exception) {
        Log.e(TAG, "Could not open Media management settings", error)
        false
      }
    }

    Function("listSharedFiles") { category: String, limit: Int ->
      listSharedFiles(category, limit.coerceIn(1, 200))
    }

    AsyncFunction("deleteMediaByPath") { path: String, promise: Promise ->
      if (pendingPromise != null) {
        promise.reject("E_DELETE_BUSY", "Another media deletion is awaiting Android authorization.", null)
        return@AsyncFunction
      }

      Log.d(TAG, "deleteMediaByPath input=$path")
      val mediaUri = findMediaUri(path)
      Log.d(TAG, "resolved mediaUri=$mediaUri")
      if (mediaUri == null) {
        promise.resolve(false)
        return@AsyncFunction
      }

      val resolver = context.contentResolver
      try {
        val deleted = resolver.delete(mediaUri, null, null)
        Log.d(TAG, "ContentResolver.delete uri=$mediaUri result=$deleted")
        if (deleted > 0) {
          promise.resolve(true)
          return@AsyncFunction
        }
      } catch (error: SecurityException) {
        Log.w(TAG, "Direct MediaStore delete requires authorization", error)
      } catch (error: UnsupportedOperationException) {
        Log.w(TAG, "Direct MediaStore delete unsupported", error)
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
          Log.d(TAG, "Starting MediaStore.createDeleteRequest for $mediaUri")
          val request = MediaStore.createDeleteRequest(resolver, listOf(mediaUri))
          pendingPromise = promise
          activity.startIntentSenderForResult(
            request.intentSender,
            DELETE_REQUEST_CODE,
            null,
            0,
            0,
            0
          )
          return@AsyncFunction
        } catch (error: Exception) {
          pendingPromise = null
          Log.e(TAG, "Could not start Android delete request", error)
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
      Log.d(TAG, "Android delete request resultCode=${payload.resultCode}")
      promise?.resolve(payload.resultCode == Activity.RESULT_OK)
    }
  }

  private fun listSharedFiles(category: String, limit: Int): List<Bundle> {
    val collection = MediaStore.Files.getContentUri("external")
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
    try {
      context.contentResolver.query(
        collection,
        projection,
        null,
        null,
        "${MediaStore.Files.FileColumns.DATE_MODIFIED} DESC"
      )?.use { cursor ->
        val idIndex = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID)
        val nameIndex = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DISPLAY_NAME)
        val mimeIndex = cursor.getColumnIndex(MediaStore.Files.FileColumns.MIME_TYPE)
        val sizeIndex = cursor.getColumnIndex(MediaStore.Files.FileColumns.SIZE)
        val modifiedIndex = cursor.getColumnIndex(MediaStore.Files.FileColumns.DATE_MODIFIED)
        val relativeIndex = cursor.getColumnIndex(MediaStore.Files.FileColumns.RELATIVE_PATH)
        val mediaTypeIndex = cursor.getColumnIndex(MediaStore.Files.FileColumns.MEDIA_TYPE)

        while (cursor.moveToNext() && results.size < limit) {
          val mediaType = if (mediaTypeIndex >= 0) cursor.getInt(mediaTypeIndex) else 0
          if (mediaType != MediaStore.Files.FileColumns.MEDIA_TYPE_NONE) continue

          val name = cursor.getString(nameIndex) ?: continue
          val mimeType = if (mimeIndex >= 0 && !cursor.isNull(mimeIndex)) cursor.getString(mimeIndex) else "application/octet-stream"
          val fileCategory = classifyFile(name, mimeType)
          if (fileCategory != category && category != "all") continue
          if (name.startsWith(".")) continue

          val id = cursor.getLong(idIndex)
          val uri = ContentUris.withAppendedId(collection, id).toString()
          val relativePath = if (relativeIndex >= 0 && !cursor.isNull(relativeIndex)) cursor.getString(relativeIndex) else ""
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

  private fun findMediaUri(rawPath: String): Uri? {
    if (rawPath.startsWith("content://")) return Uri.parse(rawPath)

    val targetPath = Uri.parse(rawPath).path ?: rawPath
    val resolver = context.contentResolver
    val fileName = targetPath.substringAfterLast('/')
    val relativePath = relativePathFor(targetPath)
    Log.d(TAG, "lookup targetPath=$targetPath fileName=$fileName relativePath=$relativePath sdk=${Build.VERSION.SDK_INT}")

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      findInCollection(resolver, MediaStore.Images.Media.EXTERNAL_CONTENT_URI, "images", fileName, relativePath)?.let { return it }
      findInCollection(resolver, MediaStore.Video.Media.EXTERNAL_CONTENT_URI, "videos", fileName, relativePath)?.let { return it }
      findInCollection(resolver, MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, "audio", fileName, relativePath)?.let { return it }
      findByDisplayName(resolver, MediaStore.Images.Media.EXTERNAL_CONTENT_URI, "images", fileName)?.let { return it }
      findByDisplayName(resolver, MediaStore.Video.Media.EXTERNAL_CONTENT_URI, "videos", fileName)?.let { return it }
      findByDisplayName(resolver, MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, "audio", fileName)?.let { return it }
    }

    val collection = MediaStore.Files.getContentUri("external")
    val projection = arrayOf(MediaStore.Files.FileColumns._ID, MediaStore.Files.FileColumns.MEDIA_TYPE)
    return try {
      resolver.query(collection, projection, "${MediaStore.Files.FileColumns.DATA} = ?", arrayOf(targetPath), null)?.use { cursor ->
        if (!cursor.moveToFirst()) return@use null
        val id = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID))
        val mediaType = cursor.getInt(cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.MEDIA_TYPE))
        when (mediaType) {
          MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE -> ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id)
          MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO -> ContentUris.withAppendedId(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, id)
          MediaStore.Files.FileColumns.MEDIA_TYPE_AUDIO -> ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id)
          else -> ContentUris.withAppendedId(collection, id)
        }
      }
    } catch (error: Exception) {
      Log.w(TAG, "legacy DATA query failed", error)
      null
    }
  }

  private fun findInCollection(resolver: android.content.ContentResolver, collection: Uri, label: String, fileName: String, relativePath: String): Uri? {
    return try {
      resolver.query(collection, arrayOf(MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.RELATIVE_PATH), "${MediaStore.MediaColumns.DISPLAY_NAME} = ? AND ${MediaStore.MediaColumns.RELATIVE_PATH} = ?", arrayOf(fileName, relativePath), null)?.use { cursor ->
        if (!cursor.moveToFirst()) null else ContentUris.withAppendedId(collection, cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)))
      }
    } catch (error: Exception) {
      Log.w(TAG, "$label name+relative query failed", error)
      null
    }
  }

  private fun findByDisplayName(resolver: android.content.ContentResolver, collection: Uri, label: String, fileName: String): Uri? {
    return try {
      resolver.query(collection, arrayOf(MediaStore.MediaColumns._ID), "${MediaStore.MediaColumns.DISPLAY_NAME} = ?", arrayOf(fileName), null)?.use { cursor ->
        if (cursor.moveToFirst()) ContentUris.withAppendedId(collection, cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID))) else null
      }
    } catch (error: Exception) {
      Log.w(TAG, "$label name-only query failed", error)
      null
    }
  }

  private fun relativePathFor(path: String): String {
    val normalized = path.removePrefix("/storage/emulated/0/").removePrefix("/")
    val slash = normalized.lastIndexOf('/')
    if (slash < 0) return ""
    return normalized.substring(0, slash + 1)
  }
}
