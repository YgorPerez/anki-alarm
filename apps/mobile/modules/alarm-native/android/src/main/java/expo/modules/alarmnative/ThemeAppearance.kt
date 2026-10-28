package expo.modules.alarmnative

import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Native launch preferences are separate from the synced settings record. */
object ThemeAppearance {
  fun prefs(context: Context) = context.getSharedPreferences("theme-appearance", Context.MODE_PRIVATE)

  fun save(activity: Activity, choice: String, light: Int, dark: Int) {
    require(light in 0..3 && dark in 0..3)
    if (Build.VERSION.SDK_INT >= 33) {
      val id = activity.resources.getIdentifier("ThemeSplash_${light}_${dark}", "style", activity.packageName)
      require(id != 0) { "Rebuild the APK to install theme resources" }
      activity.splashScreen.setSplashScreenTheme(id)
    }
    check(prefs(activity).edit().putString("choice", choice).commit())
  }

  fun queue(context: Context, primary: Int, secondary: Int) {
    require(primary in 0..4 && secondary in 0..3)
    val prefs = prefs(context)
    val target = "ThemeIcon_${primary}_${secondary}"
    val edit = prefs.edit()
    if (target == prefs.getString("icon", "ThemeIcon_0_0")) edit.remove("pending")
    else edit.putString("pending", target)
    check(edit.commit())
  }

  fun applyPending(activity: Activity) {
    val prefs = prefs(activity)
    val pending = prefs.getString("pending", null) ?: return
    val pm = activity.packageManager
    val desired = ComponentName(activity.packageName, "${activity.packageName}.$pending")
    // Enable first on older Android: even if interrupted, a launcher entry remains available.
    if (Build.VERSION.SDK_INT >= 33) {
      val changes = (0..4).flatMap { p -> (0..3).map { s ->
        val component = ComponentName(activity.packageName, "${activity.packageName}.ThemeIcon_${p}_${s}")
        PackageManager.ComponentEnabledSetting(component,
          if (component == desired) PackageManager.COMPONENT_ENABLED_STATE_ENABLED else PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
          PackageManager.DONT_KILL_APP)
      } }
      pm.setComponentEnabledSettings(changes)
    } else {
      pm.setComponentEnabledSetting(desired, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP)
      for (p in 0..4) for (s in 0..3) {
        val component = ComponentName(activity.packageName, "${activity.packageName}.ThemeIcon_${p}_${s}")
        if (component != desired) pm.setComponentEnabledSetting(component, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP)
      }
    }
    prefs.edit().remove("pending").putString("icon", pending).commit()
  }
}

class ThemeAppearanceModule : Module() {
  private val context get() = requireNotNull(appContext.reactContext)
  override fun definition() = ModuleDefinition {
    Name("ThemeAppearance")
    Function("getChoice") { ThemeAppearance.prefs(context).getString("choice", null) }
    Function("save") { choice: String, light: Int, dark: Int ->
      val activity = requireNotNull(appContext.currentActivity)
      ThemeAppearance.save(activity, choice, light, dark)
    }
    Function("queueIcon") { primary: Int, secondary: Int -> ThemeAppearance.queue(context, primary, secondary) }
  }
}
