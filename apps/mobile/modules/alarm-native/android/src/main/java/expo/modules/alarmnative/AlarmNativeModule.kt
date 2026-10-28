package expo.modules.alarmnative

import android.app.AlarmManager
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.ActivityCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject

class AlarmNativeModule : Module() {
  companion object {
    private var current: AlarmNativeModule? = null
    fun emit() { current?.sendEvent("onChange", emptyMap<String, Any>()) }
  }
  private val context: Context get() = requireNotNull(appContext.reactContext)
  override fun definition() = ModuleDefinition {
    Name("AlarmNative")
    Events("onChange")
    Function("createId") { AlarmStore.uuid7() }
    OnCreate { current = this@AlarmNativeModule; AlarmService.ensureChannel(context) }
    OnDestroy { current = null }
    Function("setAlarms") { alarms: String, policy: String -> AlarmScheduler.setAlarms(context, JSONArray(alarms), JSONObject(policy)) }
    Function("setAppearance") { colors: String, locale: String -> AlarmStore.setAppearance(context, JSONObject(colors), locale) }
    Function("list") { AlarmStore.alarms(context).toString() }
    Function("getRing") { AlarmStore.ring(context)?.toString() }
    Function("drainJournal") { AlarmStore.prefs(context).getString("journal", "[]") }
    Function("ack") { ids: List<String> -> AlarmStore.ack(context, ids) }
    Function("dismiss") { ringId: String ->
      if (AlarmStore.ring(context)?.getString("id") == ringId) {
        // Persist dismissal synchronously before returning to JS.
        AlarmStore.finish(context)
        android.os.Handler(android.os.Looper.getMainLooper()).post {
          AlarmService.instance?.dismiss() ?: AlarmService.dismissWithoutService(context)
        }
      }
    }
    Function("getPermissions") {
      mapOf("notifications" to context.getSystemService(NotificationManager::class.java).areNotificationsEnabled(),
        "exactAlarm" to (Build.VERSION.SDK_INT < 31 || context.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()),
        "fullScreenIntent" to (Build.VERSION.SDK_INT < 34 || context.getSystemService(NotificationManager::class.java).canUseFullScreenIntent()),
        "overlay" to Settings.canDrawOverlays(context),
        "battery" to context.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName))
    }
    Function("request") { kind: String ->
      if (kind == "notifications" && Build.VERSION.SDK_INT >= 33) {
        appContext.currentActivity?.let { ActivityCompat.requestPermissions(it, arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 7) }
      } else {
        val action = when {
          kind == "exactAlarm" && Build.VERSION.SDK_INT >= 31 -> Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM
          kind == "fullScreenIntent" && Build.VERSION.SDK_INT >= 34 -> Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT
          kind == "overlay" -> Settings.ACTION_MANAGE_OVERLAY_PERMISSION
          kind == "battery" -> Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
          else -> Settings.ACTION_APPLICATION_DETAILS_SETTINGS
        }
        context.startActivity(Intent(action, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
    }
  }
}
