package expo.modules.alarmnative

import android.app.Activity
import android.content.Context
import android.os.Build
import androidx.core.app.ActivityCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject

class AlarmNativeModule : Module() {
  companion object {
    private var current: AlarmNativeModule? = null
    private const val PICK_SOUND = 4545
    fun emit() { current?.sendEvent("onChange", emptyMap<String, Any>()) }
  }
  private val context: Context get() = requireNotNull(appContext.reactContext)
  private var picking: Pair<String, Promise>? = null
  override fun definition() = ModuleDefinition {
    Name("AlarmNative")
    Events("onChange")
    Function("createId") { AlarmStore.uuid7() }
    OnCreate { current = this@AlarmNativeModule; AlarmService.ensureChannel(context) }
    OnDestroy { current = null; picking?.second?.resolve(null); picking = null; Sounds.stopPreview() }
    // Resolves with the picked sound's JSON, or null when the picker is cancelled.
    AsyncFunction("pickSound") { kind: String, currentUri: String?, promise: Promise ->
      val activity = appContext.currentActivity ?: return@AsyncFunction promise.resolve(null)
      picking?.second?.resolve(null)
      picking = kind to promise
      try {
        require(kind == "ringtone" || kind == "file")
        activity.startActivityForResult(Sounds.picker(kind, currentUri), PICK_SOUND)
      } catch (e: Exception) {
        picking = null
        promise.reject("ERR_SOUND_PICKER", "Could not open sound picker", e)
      }
    }.runOnQueue(Queues.MAIN)
    OnActivityResult { _, result ->
      if (result.requestCode != PICK_SOUND) return@OnActivityResult
      val (kind, promise) = picking ?: return@OnActivityResult
      picking = null
      try {
        promise.resolve(if (result.resultCode == Activity.RESULT_OK) Sounds.picked(context, kind, result.data)?.toString() else null)
      } catch (e: Exception) {
        promise.reject("ERR_SOUND_PICKER", "Could not read selected sound", e)
      }
    }
    Function("previewSound") { sound: String -> Sounds.preview(context, JSONObject(sound)) }
    Function("stopPreview") { Sounds.stopPreview() }
    Function("setAlarms") { alarms: String, policy: String -> AlarmScheduler.setAlarms(context, JSONArray(alarms), JSONObject(policy)) }
    Function("setAppearance") { colors: String, locale: String -> AlarmStore.setAppearance(context, JSONObject(colors), locale) }
    Function("list") { AlarmStore.alarms(context).toString() }
    Function("getRing") { AlarmStore.ring(context)?.toString() }
    Function("drainJournal") { AlarmStore.prefs(context).getString("journal", "[]") }
    Function("ack") { ids: List<String> -> AlarmStore.ack(context, ids) }
    // Start: silence the ring and begin the idle timer. Native keeps the phase for restarts.
    Function("sessionStarted") { ringId: String ->
      if (AlarmStore.setPhase(context, ringId, "session"))
        android.os.Handler(android.os.Looper.getMainLooper()).post { AlarmService.instance?.startSession() }
    }
    // Any tap or answer in the session restarts the idle timer.
    Function("activity") { ringId: String ->
      if (AlarmStore.ring(context)?.getString("id") == ringId)
        android.os.Handler(android.os.Looper.getMainLooper()).post { AlarmService.instance?.onActivity() }
    }
    // N right. `awakeCheckAfter` (seconds, or null) schedules the awake check with the dismissal.
    Function("dismiss") { ringId: String, awakeCheckAfter: Int? ->
      if (AlarmStore.ring(context)?.getString("id") == ringId) {
        // Persist dismissal synchronously before returning to JS.
        AlarmStore.finish(context, awakeCheckAfter)
        AwakeCheck.advance(context)
        android.os.Handler(android.os.Looper.getMainLooper()).post {
          AlarmService.instance?.dismiss() ?: AlarmService.dismissWithoutService(context)
        }
      }
    }
    Function("getAwakeCheck") { AwakeCheck.pending(context)?.toString() }
    // The check's card was answered, any grade. Ignores a check that isn't the pending one.
    Function("awakeCheckPassed") { checkId: String -> AwakeCheck.passed(context, checkId) }
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
