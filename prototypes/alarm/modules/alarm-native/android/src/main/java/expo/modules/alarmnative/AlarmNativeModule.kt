package expo.modules.alarmnative

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.core.app.ActivityCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AlarmNativeModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext)

  private val main = Handler(Looper.getMainLooper())

  override fun definition() = ModuleDefinition {
    Name("AlarmNative")

    OnCreate { AlarmService.ensureChannel(context) }

    Function("getState") { AlarmStore.snapshot(context) }

    Function("getLog") { AlarmStore.readLog(context).asReversed() }

    Function("clearLog") { AlarmStore.clearLog(context) }

    Function("schedule") { seconds: Int -> AlarmScheduler.schedule(context, seconds) }

    Function("cancel") { id: Int -> AlarmScheduler.cancel(context, id) }

    Function("ringNow") { AlarmService.start(context, "ring now button") }

    Function("startSession") { main.post { AlarmService.instance?.startSession() } }

    Function("answer") { good: Boolean ->
      val correct = if (good) AlarmStore.incrementCorrect(context) else AlarmStore.correct(context)
      main.post { AlarmService.instance?.answered(good) }
      correct
    }

    Function("dismiss") {
      main.post {
        val service = AlarmService.instance
        if (service != null) service.dismiss() else AlarmService.dismissWithoutService(context)
      }
    }

    Function("setSetting") { key: String, value: Int ->
      AlarmStore.setSetting(context, key, value)
      AlarmStore.log(context, "setting $key=$value")
    }

    Function("requestNotifications") {
      val activity = appContext.currentActivity
      if (Build.VERSION.SDK_INT >= 33 && activity != null) {
        ActivityCompat.requestPermissions(activity, arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 7)
      }
    }

    Function("openSettings") { target: String ->
      val pkg = Uri.parse("package:${context.packageName}")
      val intent = when {
        target == "exactAlarm" && Build.VERSION.SDK_INT >= 31 -> Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, pkg)
        target == "fullScreenIntent" && Build.VERSION.SDK_INT >= 34 -> Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, pkg)
        target == "overlay" -> Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, pkg)
        target == "battery" -> Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, pkg)
        else -> Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg)
      }
      try {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      } catch (e: Exception) {
        AlarmStore.log(context, "can't open $target settings (${e.message}), opening app settings")
        context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
    }
  }
}
