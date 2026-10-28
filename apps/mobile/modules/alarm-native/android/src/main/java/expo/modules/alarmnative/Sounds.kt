package expo.modules.alarmnative

import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.provider.Settings
import org.json.JSONObject

/** The alarm's sound choice as Core models it: `{ kind: "default" | "bundled" | "ringtone" | "file", ... }`. */
object Sounds {
  private const val PREVIEW_MS = 8_000L
  private val handler = Handler(Looper.getMainLooper())
  private var preview: MediaPlayer? = null

  /** The URI the sound is copied from, or null for the phone's alarm sound. */
  fun source(ctx: Context, sound: JSONObject?): String? = when (sound?.optString("kind")) {
    "bundled" -> sound.optString("id").takeIf { ctx.resources.getIdentifier("alarm_$it", "raw", ctx.packageName) != 0 }
      ?.let { "android.resource://${ctx.packageName}/raw/alarm_$it" }
    "ringtone", "file" -> sound.optString("uri").takeIf { it.isNotEmpty() }
    else -> null
  }

  fun picker(kind: String, current: String?): Intent =
    if (kind == "ringtone") {
      Intent(RingtoneManager.ACTION_RINGTONE_PICKER)
        .putExtra(RingtoneManager.EXTRA_RINGTONE_TYPE, RingtoneManager.TYPE_ALARM)
        .putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, true)
        .putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, false)
        .putExtra(RingtoneManager.EXTRA_RINGTONE_EXISTING_URI, current?.let { Uri.parse(it) })
    } else {
      Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("audio/*")
    }

  /** The picked sound, or null if nothing was picked. A file keeps its read grant, so it can be copied again. */
  fun picked(ctx: Context, kind: String, data: Intent?): JSONObject? {
    val uri: Uri = (if (kind == "ringtone") {
      @Suppress("DEPRECATION")
      data?.getParcelableExtra(RingtoneManager.EXTRA_RINGTONE_PICKED_URI)
    } else {
      data?.data
    }) ?: return null
    val title = if (kind == "ringtone") {
      RingtoneManager.getRingtone(ctx, uri)?.getTitle(ctx)
    } else {
      try {
        ctx.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
      } catch (e: SecurityException) {
        AlarmStore.log(ctx, "no persistable grant for $uri: ${e.message}")
      }
      ctx.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { if (it.moveToFirst()) it.getString(0) else null }
    }
    return JSONObject().put("kind", kind).put("uri", uri.toString()).put("title", title ?: "")
  }

  /** Plays a few seconds of the sound on the alarm stream, as it will ring. */
  fun preview(ctx: Context, sound: JSONObject) {
    stopPreview()
    val uri = source(ctx, sound)?.let { Uri.parse(it) } ?: Settings.System.DEFAULT_ALARM_ALERT_URI
    val player = MediaPlayer()
    try {
      player.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
      player.setDataSource(ctx, uri)
      player.isLooping = true
      player.prepare()
      player.start()
      preview = player
      handler.postDelayed(::stopPreview, PREVIEW_MS)
    } catch (e: Exception) {
      player.release()
      AlarmStore.log(ctx, "can't preview $uri: ${e.javaClass.simpleName}: ${e.message}")
    }
  }

  fun stopPreview() {
    handler.removeCallbacksAndMessages(null)
    preview?.run {
      try { stop() } catch (_: Exception) {}
      release()
    }
    preview = null
  }
}
