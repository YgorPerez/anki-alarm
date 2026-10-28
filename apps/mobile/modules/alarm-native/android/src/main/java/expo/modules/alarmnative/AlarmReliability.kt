package expo.modules.alarmnative

import android.app.ActivityManager
import android.app.AlarmManager
import android.app.AppOpsManager
import android.app.NotificationManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.pm.PackageInstaller
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings

/** Hidden OEM reads are advisory. Missing APIs and ambiguous values are never grants. */
object AlarmReliability {
  private fun state(value: Boolean) = if (value) "granted" else "denied"
  private fun read(block: () -> String): String = try { block() } catch (_: Exception) { "unknown" }
  private fun op(context: Context, code: Int): String = read {
    val manager = context.getSystemService(AppOpsManager::class.java)
    val mode = AppOpsManager::class.java.getMethod("checkOpNoThrow", Int::class.javaPrimitiveType, Int::class.javaPrimitiveType, String::class.java)
      .invoke(manager, code, context.applicationInfo.uid, context.packageName) as Int
    when (mode) { AppOpsManager.MODE_ALLOWED -> "granted"; AppOpsManager.MODE_IGNORED, AppOpsManager.MODE_ERRORED -> "denied"; else -> "unknown" }
  }
  fun permissions(context: Context): Map<String, Any?> {
    val nm = context.getSystemService(NotificationManager::class.java)
    val brand = Build.MANUFACTURER.lowercase()
    val xiaomi = brand in listOf("xiaomi", "redmi", "poco")
    return mapOf(
      "manufacturer" to Build.MANUFACTURER, "sdk" to Build.VERSION.SDK_INT,
      "installSource" to read {
        if (Build.VERSION.SDK_INT < 33) "unknown" else when (context.packageManager.getInstallSourceInfo(context.packageName).packageSource) {
          PackageInstaller.PACKAGE_SOURCE_STORE -> "store"
          PackageInstaller.PACKAGE_SOURCE_LOCAL_FILE -> "local"
          PackageInstaller.PACKAGE_SOURCE_DOWNLOADED_FILE -> "downloaded"
          else -> "unknown"
        }
      },
      "standbyBucket" to (if (Build.VERSION.SDK_INT >= 28) context.getSystemService(UsageStatsManager::class.java).appStandbyBucket else null),
      "notifications" to state(nm.areNotificationsEnabled() && (Build.VERSION.SDK_INT < 26 || nm.getNotificationChannel("alarm_ringing_v1")?.importance != NotificationManager.IMPORTANCE_NONE)),
      "exactAlarm" to state(Build.VERSION.SDK_INT < 31 || context.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()),
      "fullScreenIntent" to state(Build.VERSION.SDK_INT < 34 || nm.canUseFullScreenIntent()),
      "overlay" to state(Settings.canDrawOverlays(context)),
      "battery" to state(context.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName)),
      "backgroundRestricted" to (if (Build.VERSION.SDK_INT >= 28) state(!context.getSystemService(ActivityManager::class.java).isBackgroundRestricted) else "unknown"),
      "lockScreen" to (if (xiaomi) op(context, 10020) else "unknown"),
      "backgroundPopups" to (if (xiaomi) op(context, 10021) else "unknown"),
      // Autostart and PowerKeeper formats differ between MIUI and HyperOS; ask by hand.
      "autostart" to "unknown", "noRestrictions" to "unknown"
    )
  }
  fun open(context: Context, kind: String): Boolean {
    val pkg = context.packageName
    val appInfo = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$pkg"))
    fun setting(action: String) = Intent(action, Uri.parse("package:$pkg"))
    val brand = Build.MANUFACTURER.lowercase()
    val xiaomi = brand in listOf("xiaomi", "redmi", "poco")
    val intent = when {
      kind == "notifications" -> Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg)
      kind == "exactAlarm" && Build.VERSION.SDK_INT >= 31 -> setting(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM)
      kind == "fullScreenIntent" && Build.VERSION.SDK_INT >= 34 -> setting(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT)
      kind == "overlay" -> setting(Settings.ACTION_MANAGE_OVERLAY_PERMISSION)
      kind == "battery" -> setting(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
      kind == "autostart" && xiaomi -> Intent("miui.intent.action.OP_AUTO_START").putExtra("extra_pkgname", pkg)
      kind in listOf("lockScreen", "backgroundPopups") && xiaomi -> Intent("miui.intent.action.APP_PERM_EDITOR").putExtra("extra_pkgname", pkg)
      kind == "noRestrictions" && xiaomi -> Intent().setClassName("com.miui.powerkeeper", "com.miui.powerkeeper.ui.HiddenAppsConfigActivity").putExtra("package_name", pkg).putExtra("package_label", context.applicationInfo.loadLabel(context.packageManager).toString())
      kind == "neverSleeping" -> Intent("com.samsung.android.sm.ACTION_OPEN_CHECKABLE_LISTACTIVITY").setPackage("com.samsung.android.lool").putExtra("activity_type", 2)
      kind == "autostart" && brand == "oneplus" -> Intent().setClassName("com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity")
      kind == "autostart" && brand in listOf("oppo", "realme") -> Intent().setClassName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity")
      kind == "autostart" && brand == "vivo" -> Intent().setClassName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity")
      else -> appInfo
    }
    for (candidate in listOf(intent, appInfo)) {
      try { context.startActivity(candidate.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return true }
      catch (_: Exception) { /* OEM settings may be absent or not exported. */ }
    }
    return false
  }
}
