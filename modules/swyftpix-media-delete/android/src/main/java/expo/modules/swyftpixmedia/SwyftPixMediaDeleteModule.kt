package expo.modules.swyftpixmedia

import android.app.Activity
import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.os.Build
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
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
        return@Function false
      }

      MediaStore.canManageMedia(context)
    }

    Function("requestMediaManagementAccess") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
        return@Function false
      }

      val activity = appContext.activityProvider?.currentActivity
        ?: return@Function false

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

  private fun findMediaUri(rawPath: String): Uri? {
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
      resolver.query(
        collection,
        projection,
        "${MediaStore.Files.FileColumns.DATA} = ?",
        arrayOf(targetPath),
        null
      )?.use { cursor ->
        Log.d(TAG, "legacy DATA query count=${cursor.count}")
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

  private fun findInCollection(
    resolver: android.content.ContentResolver,
    collection: Uri,
    label: String,
    fileName: String,
    relativePath: String
  ): Uri? {
    return try {
      resolver.query(
        collection,
        arrayOf(MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.RELATIVE_PATH),
        "${MediaStore.MediaColumns.DISPLAY_NAME} = ? AND ${MediaStore.MediaColumns.RELATIVE_PATH} = ?",
        arrayOf(fileName, relativePath),
        null
      )?.use { cursor ->
        Log.d(TAG, "$label name+relative query count=${cursor.count}")
        if (!cursor.moveToFirst()) null
        else ContentUris.withAppendedId(collection, cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)))
      }
    } catch (error: Exception) {
      Log.w(TAG, "$label name+relative query failed", error)
      null
    }
  }

  private fun findByDisplayName(
    resolver: android.content.ContentResolver,
    collection: Uri,
    label: String,
    fileName: String
  ): Uri? {
    return try {
      resolver.query(
        collection,
        arrayOf(MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.RELATIVE_PATH),
        "${MediaStore.MediaColumns.DISPLAY_NAME} = ?",
        arrayOf(fileName),
        null
      )?.use { cursor ->
        Log.d(TAG, "$label name-only query count=${cursor.count}")
        if (cursor.moveToFirst()) {
          val relativeColumn = cursor.getColumnIndex(MediaStore.MediaColumns.RELATIVE_PATH)
          val storedRelative = if (relativeColumn >= 0 && !cursor.isNull(relativeColumn)) cursor.getString(relativeColumn) else "<null>"
          Log.d(TAG, "$label name-only match relativePath=$storedRelative")
          ContentUris.withAppendedId(collection, cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)))
        } else null
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
