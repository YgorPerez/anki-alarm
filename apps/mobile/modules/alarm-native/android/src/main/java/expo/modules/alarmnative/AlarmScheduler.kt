package expo.modules.alarmnative

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.UserManager
import org.json.JSONArray
import org.json.JSONObject
import java.time.ZoneId

object AlarmScheduler {
  const val ACTION_FIRE = "expo.modules.alarmnative.FIRE"
  const val ACTION_WATCHDOG = "expo.modules.alarmnative.WATCHDOG"
  private fun am(ctx: Context) = ctx.getSystemService(AlarmManager::class.java)
  fun launchIntent(ctx: Context): Intent =
    (if (!ctx.getSystemService(UserManager::class.java).isUserUnlocked) Intent(ctx, LockedAlarmActivity::class.java)
    else ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)!!)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP).putExtra("alarm", true)
  fun showIntent(ctx: Context): PendingIntent = PendingIntent.getActivity(ctx, 1, launchIntent(ctx), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  private fun operation(ctx: Context, id: String) = PendingIntent.getBroadcast(ctx, 0,
    Intent(ctx, AlarmReceiver::class.java).setAction(if(id == "watchdog") ACTION_WATCHDOG else ACTION_FIRE)
      .setData(Uri.parse("anki-alarm://schedule/$id")).putExtra("id", id), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  private fun arm(ctx: Context, id: String, at: Long) {
    am(ctx).setAlarmClock(AlarmManager.AlarmClockInfo(at, showIntent(ctx)), operation(ctx, id))
  }
  fun next(alarm: JSONObject, now: Long): Long? {
    val r = alarm.getJSONObject("rule"); val days = r.optJSONArray("repeatDays") ?: JSONArray()
    return NextRing.calculate(r.getInt("hour"), r.getInt("minute"), (0 until days.length()).map { days.getInt(it) },
      r.optString("onceDate").takeIf { it.isNotEmpty() }, now, ZoneId.systemDefault().id)
  }
  @Synchronized fun setAlarms(ctx: Context, alarms: JSONArray, policy: JSONObject, now: Long = System.currentTimeMillis()) {
    val previous = AlarmStore.alarms(ctx)
    val sources = (0 until previous.length()).associate { previous.getJSONObject(it).let { a -> a.getString("id") to a.optString("soundSource") } }
    val staleBefore = ctx.packageManager.getPackageInfo(ctx.packageName, 0).lastUpdateTime
    val copied = JSONArray()
    for (i in 0 until alarms.length()) {
      val alarm = alarms.getJSONObject(i)
      // Freeze the chosen sound into Direct Boot storage before scheduling it.
      val source = Sounds.source(ctx, alarm.optJSONObject("sound"))
      val file = java.io.File(ctx.createDeviceProtectedStorageContext().filesDir, "alarm-${alarm.getString("id")}.audio")
      val frozen = SoundFile.freeze(source, sources[alarm.getString("id")], file, staleBefore) { ctx.contentResolver.openInputStream(Uri.parse(it))!! }
      if (source != null && frozen == null) AlarmStore.log(ctx, "can't copy $source: the alarm will ring the phone's alarm sound")
      alarm.putOpt("soundSource", source).putOpt("soundFile", frozen?.let { Uri.fromFile(it).toString() })
      copied.put(alarm)
    }
    check(AlarmStore.prefs(ctx).edit().putString("alarms", copied.toString()).putString("policy", policy.toString()).commit())
    for (i in 0 until previous.length()) am(ctx).cancel(operation(ctx, previous.getJSONObject(i).getString("id")))
    rearmAll(ctx, "setAlarms", now)
  }
  @Synchronized fun fire(ctx: Context, id: String, now: Long = System.currentTimeMillis()) {
    val list = AlarmStore.alarms(ctx)
    val alarm = (0 until list.length()).map { list.getJSONObject(it) }.find { it.getString("id") == id } ?: return
    if (!alarm.optBoolean("enabled", true)) return
    val due = AlarmStore.prefs(ctx).getLong("due.$id", 0)
    if (due == 0L || due > now) return
    AlarmStore.prefs(ctx).edit().remove("due.$id").commit()
    AlarmStore.fire(ctx, alarm)
    rearmAll(ctx, "fired", now)
  }
  @Synchronized fun rearmAll(ctx: Context, why: String, now: Long = System.currentTimeMillis()) {
    val list = AlarmStore.alarms(ctx)
    for (i in 0 until list.length()) {
      val alarm = list.getJSONObject(i); val id = alarm.getString("id")
      if (!alarm.optBoolean("enabled", true)) continue
      val due = AlarmStore.prefs(ctx).getLong("due.$id", 0)
      if (due in 1..now && why != "setAlarms") {
        AlarmStore.prefs(ctx).edit().remove("due.$id").commit()
        if (now - due <= 30 * 60_000) AlarmStore.fire(ctx, alarm) else AlarmStore.event(ctx, "missed", id)
      }
      val at = next(alarm, now)
      if (at != null) {
        check(AlarmStore.prefs(ctx).edit().putLong("due.$id", at).commit())
        arm(ctx, id, at)
      } else { AlarmStore.prefs(ctx).edit().remove("due.$id").commit() }
    }
    if (AlarmStore.isRinging(ctx)) {
      val service = AlarmService.instance
      if (service == null) AlarmService.start(ctx, "restored $why")
      else if (why == "BOOT_COMPLETED") service.onUnlocked()
    }
  }
  fun armWatchdog(ctx: Context, inMs: Long) = arm(ctx, "watchdog", System.currentTimeMillis() + inMs)
  fun cancelWatchdog(ctx: Context) = am(ctx).cancel(operation(ctx, "watchdog"))
}
