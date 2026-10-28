package expo.modules.alarmnative

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object AlarmScheduler {
  const val ACTION_FIRE = "expo.modules.alarmnative.FIRE"
  const val ACTION_WATCHDOG = "expo.modules.alarmnative.WATCHDOG"
  private const val WATCHDOG_REQUEST = 999_999

  private val clock = SimpleDateFormat("HH:mm:ss", Locale.US)

  private fun am(ctx: Context) = ctx.getSystemService(AlarmManager::class.java)

  fun launchIntent(ctx: Context): Intent =
    (ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: Intent())
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      .putExtra("alarm", true)

  fun showIntent(ctx: Context): PendingIntent =
    PendingIntent.getActivity(ctx, 1, launchIntent(ctx), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

  private fun broadcast(ctx: Context, action: String, requestCode: Int, id: Int): PendingIntent =
    PendingIntent.getBroadcast(
      ctx,
      requestCode,
      Intent(ctx, AlarmReceiver::class.java).setAction(action).putExtra("id", id),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

  private fun arm(ctx: Context, at: Long, operation: PendingIntent): Boolean =
    try {
      am(ctx).setAlarmClock(AlarmManager.AlarmClockInfo(at, showIntent(ctx)), operation)
      true
    } catch (e: SecurityException) {
      AlarmStore.log(ctx, "setAlarmClock FAILED: ${e.message}")
      false
    }

  fun schedule(ctx: Context, seconds: Int): Int {
    val id = AlarmStore.nextId(ctx)
    val at = System.currentTimeMillis() + seconds * 1000L
    AlarmStore.putAlarm(ctx, AlarmStore.Alarm(id, at))
    val ok = arm(ctx, at, broadcast(ctx, ACTION_FIRE, id, id))
    AlarmStore.log(ctx, "scheduled #$id for ${clock.format(Date(at))} (in ${seconds}s), armed=$ok")
    return id
  }

  fun cancel(ctx: Context, id: Int) {
    am(ctx).cancel(broadcast(ctx, ACTION_FIRE, id, id))
    AlarmStore.removeAlarm(ctx, id)
    AlarmStore.log(ctx, "cancelled #$id")
  }

  fun rearmAll(ctx: Context, why: String) {
    val now = System.currentTimeMillis()
    for (a in AlarmStore.alarms(ctx)) {
      if (a.at > now) {
        val ok = arm(ctx, a.at, broadcast(ctx, ACTION_FIRE, a.id, a.id))
        AlarmStore.log(ctx, "re-armed #${a.id} for ${clock.format(Date(a.at))} ($why), armed=$ok")
      } else {
        AlarmStore.removeAlarm(ctx, a.id)
        AlarmStore.log(ctx, "MISSED #${a.id}, was due ${clock.format(Date(a.at))} ($why)")
      }
    }
    if (AlarmStore.isRinging(ctx) && AlarmService.instance == null) {
      AlarmService.start(ctx, "session was ringing before $why")
    }
  }

  fun armWatchdog(ctx: Context, inMs: Long) {
    arm(ctx, System.currentTimeMillis() + inMs, broadcast(ctx, ACTION_WATCHDOG, WATCHDOG_REQUEST, -1))
  }

  fun cancelWatchdog(ctx: Context) {
    am(ctx).cancel(broadcast(ctx, ACTION_WATCHDOG, WATCHDOG_REQUEST, -1))
  }
}
