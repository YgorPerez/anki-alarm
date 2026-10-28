package expo.modules.alarmnative

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.Intent
import android.os.Bundle
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener
import java.lang.ref.WeakReference

class AlarmNativePackage : Package {
  override fun createReactActivityLifecycleListeners(activityContext: Context): List<ReactActivityLifecycleListener> =
    listOf(AlarmActivityListener)
}

// Hooks the RN activity: shows it over the lock screen while ringing, and tells the service when it
// becomes visible or hidden.
object AlarmActivityListener : ReactActivityLifecycleListener {
  private var activity: WeakReference<Activity>? = null
  private var callbacksRegistered = false

  @Volatile
  var visible = false
    private set

  override fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
    this.activity = WeakReference(activity)
    val ringing = AlarmStore.isRinging(activity)
    AlarmStore.log(activity, "activity created, alarmExtra=${activity.intent?.getBooleanExtra("alarm", false)} ringing=$ringing")
    applyLockFlags(ringing)
    // A force-stop kills the service but leaves the ringing flag: opening the app resumes the ring.
    if (ringing && AlarmService.instance == null) AlarmService.start(activity, "app opened while ringing")
    if (callbacksRegistered) return
    callbacksRegistered = true
    activity.application.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
      override fun onActivityStarted(a: Activity) {
        if (a !== this@AlarmActivityListener.activity?.get()) return
        visible = true
        if (AlarmStore.isRinging(a)) {
          AlarmStore.log(a, "alarm screen visible")
          AlarmService.instance?.onScreenShown()
        }
      }

      override fun onActivityStopped(a: Activity) {
        if (a !== this@AlarmActivityListener.activity?.get()) return
        visible = false
        if (AlarmStore.isRinging(a)) {
          AlarmStore.log(a, "alarm screen hidden")
          AlarmService.instance?.onScreenLeft()
        }
      }

      override fun onActivityCreated(a: Activity, b: Bundle?) {}
      override fun onActivityResumed(a: Activity) {}
      override fun onActivityPaused(a: Activity) {}
      override fun onActivitySaveInstanceState(a: Activity, b: Bundle) {}
      override fun onActivityDestroyed(a: Activity) {}
    })
  }

  override fun onNewIntent(intent: Intent): Boolean {
    activity?.get()?.let { applyLockFlags(AlarmStore.isRinging(it)) }
    return false
  }

  override fun onBackPressed(): Boolean = activity?.get()?.let { AlarmStore.isRinging(it) } ?: false

  fun applyLockFlags(on: Boolean) {
    val a = activity?.get() ?: return
    a.runOnUiThread {
      a.setShowWhenLocked(on)
      a.setTurnScreenOn(on)
    }
  }
}
