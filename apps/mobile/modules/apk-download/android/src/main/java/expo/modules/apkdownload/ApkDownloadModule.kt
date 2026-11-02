package expo.modules.apkdownload

import android.app.DownloadManager
import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.os.Environment
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * The APK update through the system's DownloadManager, so it shows in the notification shade and
 * outlives the app. JS decides what to keep, retry or install; this only forwards (ADR 0005's split).
 */
class ApkDownloadModule : Module() {
  private val context: Context get() = requireNotNull(appContext.reactContext)
  private val manager get() = context.getSystemService(DownloadManager::class.java)

  override fun definition() = ModuleDefinition {
    Name("ApkDownload")

    // Where the in-app download used to leave the APK, on phones updating from such a version.
    OnCreate { appContext.reactContext?.let { File(it.cacheDir, "anki-alarm.apk").delete() } }

    AsyncFunction("start") { url: String, version: String ->
      val request = DownloadManager.Request(Uri.parse(url))
        .setTitle(context.applicationInfo.loadLabel(context.packageManager))
        // The version is how a relaunch recognizes this download: the description never changes,
        // while the URI can follow a permanent redirect and the file has no path until it starts.
        .setDescription(version)
        .setMimeType("application/vnd.android.package-archive")
        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        .setAllowedOverMetered(true)
        .setAllowedOverRoaming(true)
        .setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, "anki-alarm-$version.apk")
      manager.enqueue(request).toDouble()
    }

    AsyncFunction("list") { -> rows() }

    AsyncFunction("remove") { id: Double ->
      manager.remove(id.toLong())
      Unit
    }
  }

  private fun rows(): List<Map<String, Any?>> =
    manager.query(DownloadManager.Query())?.use { cursor ->
      generateSequence { if (cursor.moveToNext()) row(cursor) else null }.toList()
    } ?: emptyList()

  private fun row(cursor: Cursor): Map<String, Any?> {
    val id = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_ID))
    val status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
    return mapOf(
      "id" to id.toDouble(),
      "version" to cursor.getString(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_DESCRIPTION)),
      "status" to when (status) {
        DownloadManager.STATUS_SUCCESSFUL -> "successful"
        DownloadManager.STATUS_FAILED -> "failed"
        else -> "active" // Pending and paused too: JS gives up on one that stops moving.
      },
      "bytes" to cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)).toDouble(),
      "total" to cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)).toDouble(),
      "contentUri" to
        if (status == DownloadManager.STATUS_SUCCESSFUL) manager.getUriForDownloadedFile(id)?.toString() else null,
    )
  }
}
