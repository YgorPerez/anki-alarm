package expo.modules.alarmnative

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.PowerManager

class AlarmReceiver : BroadcastReceiver() {
  override fun onReceive(ctx: Context, intent: Intent) {
    ctx.getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "anki-alarm:receiver").acquire(30_000)
    if (intent.action == AlarmScheduler.ACTION_FIRE) AlarmScheduler.fire(ctx, intent.getStringExtra("id") ?: return)
    else if (intent.action == AlarmScheduler.ACTION_SNOOZE_END) AlarmScheduler.endSnooze(ctx)
    else if (intent.action == AwakeCheck.ACTION) AwakeCheck.advance(ctx)
    else if (AlarmStore.isRinging(ctx)) AlarmService.start(ctx, "watchdog")
  }
}
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(ctx: Context, intent: Intent) { AlarmScheduler.rearmAll(ctx, intent.action?.substringAfterLast('.') ?: "boot") }
}
