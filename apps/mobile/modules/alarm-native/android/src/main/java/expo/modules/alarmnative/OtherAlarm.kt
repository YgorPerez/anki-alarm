package expo.modules.alarmnative

import android.app.ActivityOptions
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.os.Build

/**
 * Another app's next alarm, read only. Android reports just the soonest `setAlarmClock` alarm across
 * all apps, so this is null whenever one of ours comes first.
 */
object OtherAlarm {
  private fun next(context: Context): AlarmManager.AlarmClockInfo? =
    context.getSystemService(AlarmManager::class.java).nextAlarmClock
      ?.takeUnless { it.showIntent?.creatorPackage == context.packageName }

  // Package visibility can hide the app; the UI then calls it "another app".
  private fun label(context: Context, pkg: String?): String? = try {
    pkg?.let { context.packageManager.run { getApplicationLabel(getApplicationInfo(it, 0)).toString() } }
  } catch (_: Exception) {
    null
  }

  fun read(context: Context): Map<String, Any?>? = next(context)?.let { info ->
    mapOf("at" to info.triggerTime.toDouble(), "app" to label(context, info.showIntent?.creatorPackage))
  }

  /** Opens the screen the other app registered for its alarm. False when it has none or it's gone. */
  fun open(context: Context): Boolean {
    val intent = next(context)?.showIntent ?: return false
    return try {
      // From Android 14 a sender must opt in to lending its foreground state to another app's intent.
      val options = if (Build.VERSION.SDK_INT >= 34) {
        ActivityOptions.makeBasic()
          .setPendingIntentBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED)
          .toBundle()
      } else null
      intent.send(context, 0, null, null, null, null, options)
      true
    } catch (_: PendingIntent.CanceledException) {
      false
    }
  }
}
