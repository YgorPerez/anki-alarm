package expo.modules.alarmnative

import android.app.AlarmManager
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioManager
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// PROTOTYPE: all state in SharedPreferences, written with commit() so it survives a sudden kill.
object AlarmStore {
  data class Alarm(val id: Int, val at: Long)

  val defaults = linkedMapOf(
    "rampSeconds" to 30,
    "leaveSeconds" to 10,
    "idleSeconds" to 20,
    "lowLevel" to 15,
    "vibrate" to 1,
    "forceMaxVolume" to 1,
    "directLaunch" to 1,
  )

  private val time = SimpleDateFormat("MM-dd HH:mm:ss.SSS", Locale.US)

  // Device-protected storage: readable before the first unlock after a reboot (Direct Boot),
  // so a locked phone can re-arm and ring.
  private fun prefs(ctx: Context) =
    ctx.createDeviceProtectedStorageContext().getSharedPreferences("alarm_prototype", Context.MODE_PRIVATE)

  @Synchronized
  fun log(ctx: Context, msg: String) {
    Log.i("AlarmPrototype", msg)
    val p = prefs(ctx)
    val arr = JSONArray(p.getString("log", "[]"))
    arr.put(time.format(Date()) + "  " + msg)
    val kept = JSONArray()
    for (i in maxOf(0, arr.length() - 400) until arr.length()) kept.put(arr.getString(i))
    p.edit().putString("log", kept.toString()).commit()
  }

  fun readLog(ctx: Context): List<String> {
    val arr = JSONArray(prefs(ctx).getString("log", "[]"))
    return (0 until arr.length()).map { arr.getString(it) }
  }

  fun clearLog(ctx: Context) {
    prefs(ctx).edit().remove("log").commit()
  }

  @Synchronized
  fun alarms(ctx: Context): List<Alarm> {
    val arr = JSONArray(prefs(ctx).getString("alarms", "[]"))
    return (0 until arr.length()).map { arr.getJSONObject(it) }.map { Alarm(it.getInt("id"), it.getLong("at")) }
  }

  @Synchronized
  private fun saveAlarms(ctx: Context, list: List<Alarm>) {
    val arr = JSONArray()
    list.forEach { arr.put(JSONObject().put("id", it.id).put("at", it.at)) }
    prefs(ctx).edit().putString("alarms", arr.toString()).commit()
  }

  @Synchronized
  fun nextId(ctx: Context): Int {
    val id = prefs(ctx).getInt("nextId", 1)
    prefs(ctx).edit().putInt("nextId", id + 1).commit()
    return id
  }

  fun putAlarm(ctx: Context, alarm: Alarm) = saveAlarms(ctx, alarms(ctx).filter { it.id != alarm.id } + alarm)

  fun removeAlarm(ctx: Context, id: Int) = saveAlarms(ctx, alarms(ctx).filter { it.id != id })

  fun isRinging(ctx: Context) = prefs(ctx).getBoolean("ringing", false)

  fun setRinging(ctx: Context, ringing: Boolean) {
    val e = prefs(ctx).edit().putBoolean("ringing", ringing)
    if (ringing) e.putLong("ringStartedAt", System.currentTimeMillis()).putInt("correct", 0)
    e.commit()
  }

  fun ringStartedAt(ctx: Context) = prefs(ctx).getLong("ringStartedAt", 0)

  fun correct(ctx: Context) = prefs(ctx).getInt("correct", 0)

  @Synchronized
  fun incrementCorrect(ctx: Context): Int {
    val c = correct(ctx) + 1
    prefs(ctx).edit().putInt("correct", c).commit()
    return c
  }

  fun setting(ctx: Context, key: String) = prefs(ctx).getInt("setting.$key", defaults[key] ?: 0)

  fun setSetting(ctx: Context, key: String, value: Int) {
    prefs(ctx).edit().putInt("setting.$key", value).commit()
  }

  fun permissions(ctx: Context): Map<String, Any?> {
    val am = ctx.getSystemService(AlarmManager::class.java)
    val nm = ctx.getSystemService(NotificationManager::class.java)
    val pm = ctx.getSystemService(PowerManager::class.java)
    val notifications =
      if (Build.VERSION.SDK_INT >= 33) {
        ctx.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
      } else {
        nm.areNotificationsEnabled()
      }
    return mapOf(
      "exactAlarm" to (if (Build.VERSION.SDK_INT >= 31) am.canScheduleExactAlarms() else true),
      "fullScreenIntent" to (if (Build.VERSION.SDK_INT >= 34) nm.canUseFullScreenIntent() else true),
      "notifications" to notifications,
      "overlay" to Settings.canDrawOverlays(ctx),
      "ignoringBatteryOptimizations" to pm.isIgnoringBatteryOptimizations(ctx.packageName),
    )
  }

  fun snapshot(ctx: Context): Map<String, Any?> {
    val am = ctx.getSystemService(AlarmManager::class.java)
    val audio = ctx.getSystemService(AudioManager::class.java)
    val nm = ctx.getSystemService(NotificationManager::class.java)
    val service = AlarmService.instance
    return mapOf(
      "ringing" to isRinging(ctx),
      "correct" to correct(ctx),
      "ringStartedAt" to ringStartedAt(ctx).toDouble(),
      "serviceAlive" to (service != null),
      "screenVisible" to AlarmActivityListener.visible,
      "sessionStarted" to service?.sessionStarted,
      "level" to service?.level?.toDouble(),
      "alarms" to alarms(ctx).map { mapOf("id" to it.id, "at" to it.at.toDouble()) },
      "nextSystemAlarm" to am.nextAlarmClock?.triggerTime?.toDouble(),
      "permissions" to permissions(ctx),
      "settings" to defaults.keys.associateWith { setting(ctx, it) },
      "audio" to mapOf(
        "alarmVolume" to audio.getStreamVolume(AudioManager.STREAM_ALARM),
        "alarmMax" to audio.getStreamMaxVolume(AudioManager.STREAM_ALARM),
        "ringerMode" to audio.ringerMode,
        "interruptionFilter" to nm.currentInterruptionFilter,
      ),
      "device" to mapOf(
        "manufacturer" to Build.MANUFACTURER,
        "model" to Build.MODEL,
        "release" to Build.VERSION.RELEASE,
        "sdk" to Build.VERSION.SDK_INT,
      ),
    )
  }
}
