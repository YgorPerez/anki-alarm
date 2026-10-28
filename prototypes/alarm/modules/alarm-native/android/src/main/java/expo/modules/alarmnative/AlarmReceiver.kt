package expo.modules.alarmnative

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.PowerManager

private fun holdWakeLock(ctx: Context) {
  // Keeps the CPU up between onReceive and the service reaching startForeground.
  ctx.getSystemService(PowerManager::class.java)
    .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "alarmprototype:receiver")
    .acquire(30_000)
}

class AlarmReceiver : BroadcastReceiver() {
  override fun onReceive(ctx: Context, intent: Intent) {
    holdWakeLock(ctx)
    when (intent.action) {
      AlarmScheduler.ACTION_FIRE -> {
        val id = intent.getIntExtra("id", -1)
        AlarmStore.removeAlarm(ctx, id)
        AlarmStore.log(ctx, "alarm #$id fired")
        AlarmService.start(ctx, "alarm #$id")
      }
      AlarmScheduler.ACTION_WATCHDOG -> {
        val ringing = AlarmStore.isRinging(ctx)
        val alive = AlarmService.instance != null
        AlarmStore.log(ctx, "watchdog fired: ringing=$ringing serviceAlive=$alive")
        if (ringing) AlarmService.start(ctx, "watchdog")
      }
    }
  }
}

class BootReceiver : BroadcastReceiver() {
  override fun onReceive(ctx: Context, intent: Intent) {
    holdWakeLock(ctx)
    val action = intent.action?.substringAfterLast('.') ?: "?"
    AlarmStore.log(ctx, "system broadcast $action")
    AlarmScheduler.rearmAll(ctx, action)
  }
}
