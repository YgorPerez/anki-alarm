package expo.modules.alarmnative

import android.app.NotificationManager
import android.content.Context
import android.os.UserManager
import android.provider.Settings
import androidx.core.app.NotificationCompat
import org.json.JSONObject

/**
 * The awake check after a dismissal: `{ id, ringId, alarm, dueAt, shownAt? }` in device-protected
 * storage. Both of its moments (the prompt, then the timeout) are exact alarms, so they survive kills
 * and, through `rearmAll`, reboots. JS shows the prompt and reports an answer; native never reads it.
 */
object AwakeCheck {
  const val KEY = "awakeCheck"
  const val ACTION = "expo.modules.alarmnative.AWAKE_CHECK"
  private const val NOTIFICATION_ID = 4244

  fun pending(ctx: Context): JSONObject? = AlarmStore.prefs(ctx).getString(KEY, null)?.let { JSONObject(it) }
  fun isShown(ctx: Context) = pending(ctx)?.has("shownAt") == true

  private fun unlocked(ctx: Context) = ctx.getSystemService(UserManager::class.java).isUserUnlocked

  /**
   * Moves the pending check on at `now`: waits for its delay, shows the prompt, or fails it once the
   * prompt has had its `awakeCheckSeconds`. `reshow` puts a prompt still in time back on screen
   * (after a reboot).
   */
  @Synchronized fun advance(ctx: Context, reshow: Boolean = false, now: Long = System.currentTimeMillis(), unlocked: Boolean = unlocked(ctx)) {
    val check = pending(ctx) ?: return
    val ringId = check.getString("ringId")
    val alarmId = check.getJSONObject("alarm").getString("id")
    if (!check.has("shownAt")) {
      val dueAt = check.getLong("dueAt")
      when {
        dueAt > now -> AlarmScheduler.armAwakeCheck(ctx, dueAt)
        // Another alarm is ringing or snoozed: it rings again anyway, and answering it shows they're awake.
        AlarmStore.ring(ctx) != null -> {
          AlarmStore.prefs(ctx).edit().remove(KEY).commit()
          AlarmStore.log(ctx, "awake check dropped: another ring is active")
        }
        // Before the first unlock the card can't be shown; ring so the phone gets unlocked.
        !unlocked -> fail(ctx, check)
        else -> {
          AlarmStore.event(ctx, "awakeCheckShown", alarmId, ringId = ringId) { edit ->
            edit.putString(KEY, check.put("shownAt", now).toString())
          }
          AlarmScheduler.armAwakeCheck(ctx, now + timeout(ctx))
          show(ctx)
        }
      }
      return
    }
    val endsAt = check.getLong("shownAt") + timeout(ctx)
    when {
      endsAt <= now || !unlocked -> fail(ctx, check)
      else -> {
        AlarmScheduler.armAwakeCheck(ctx, endsAt)
        if (reshow) show(ctx)
      }
    }
  }

  /** An answer came for check `id`. A stale or unknown id changes nothing. */
  @Synchronized fun passed(ctx: Context, id: String): Boolean {
    val check = pending(ctx) ?: return false
    if (check.getString("id") != id) return false
    AlarmStore.event(ctx, "awakeCheckPassed", check.getJSONObject("alarm").getString("id"), ringId = check.getString("ringId")) { edit ->
      edit.remove(KEY)
    }
    AlarmScheduler.cancelAwakeCheck(ctx)
    hide(ctx)
    return true
  }

  private fun timeout(ctx: Context) = AlarmStore.setting(ctx, "awakeCheckSeconds") * 1000L

  // No answer: journal the failure and start a new ring for the same alarm, with a fresh session.
  private fun fail(ctx: Context, check: JSONObject) {
    val alarm = check.getJSONObject("alarm")
    AlarmStore.event(ctx, "awakeCheckFailed", alarm.getString("id"), ringId = check.getString("ringId")) { edit ->
      edit.remove(KEY)
    }
    AlarmScheduler.cancelAwakeCheck(ctx)
    hide(ctx)
    AlarmStore.fire(ctx, alarm)
  }

  // A silent full-screen prompt: it wakes the screen and opens the app, but makes no sound.
  private fun show(ctx: Context) {
    AlarmService.ensureChannel(ctx)
    val prompt = NotificationCompat.Builder(ctx, AlarmService.CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setContentTitle(ctx.getString(R.string.awake_check_title))
      .setContentText(ctx.getString(R.string.awake_check_text))
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOngoing(true)
      .setContentIntent(AlarmScheduler.showIntent(ctx))
      .setFullScreenIntent(AlarmScheduler.showIntent(ctx), true)
      .build()
    try {
      ctx.getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, prompt)
    } catch (e: SecurityException) {
      AlarmStore.log(ctx, "awake check notification FAILED: ${e.message}")
    }
    AlarmActivityListener.applyLockFlags(true)
    if (Settings.canDrawOverlays(ctx)) {
      try {
        ctx.startActivity(AlarmScheduler.launchIntent(ctx))
      } catch (e: Exception) {
        AlarmStore.log(ctx, "awake check startActivity FAILED: ${e.message}")
      }
    }
  }

  private fun hide(ctx: Context) {
    ctx.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)
    AlarmActivityListener.applyLockFlags(AlarmStore.isRinging(ctx))
  }
}
