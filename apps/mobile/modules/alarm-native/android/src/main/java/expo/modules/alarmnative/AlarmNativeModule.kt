package expo.modules.alarmnative

import android.content.Context
import android.os.Build
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
    Function("getPermissions") { AlarmReliability.permissions(context) }
    Function("isOnboardingComplete") { context.getSharedPreferences("onboarding", Context.MODE_PRIVATE).getBoolean("complete", false) }
    Function("completeOnboarding") { context.getSharedPreferences("onboarding", Context.MODE_PRIVATE).edit().putBoolean("complete", true).commit() }
    Function("request") { kind: String ->
      if (kind == "notifications" && Build.VERSION.SDK_INT >= 33 &&
          context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
        val activity = appContext.currentActivity
        if (activity != null && !context.getSharedPreferences("onboarding", Context.MODE_PRIVATE).getBoolean("notificationsAsked", false)) {
          context.getSharedPreferences("onboarding", Context.MODE_PRIVATE).edit().putBoolean("notificationsAsked", true).apply()
          android.os.Handler(android.os.Looper.getMainLooper()).post {
            ActivityCompat.requestPermissions(activity, arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 7)
          }
          true
        } else AlarmReliability.open(context, kind)
      } else AlarmReliability.open(context, kind)
    }
  }
}
