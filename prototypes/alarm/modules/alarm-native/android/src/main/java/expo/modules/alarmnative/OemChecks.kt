package expo.modules.alarmnative

import android.app.ActivityManager
import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Process
import android.provider.Settings

// PROTOTYPE for #35: reads the OEM settings from docs/research/oem-background-limits.md and opens
// their screens. Every read is best-effort: "granted", "denied" or "unknown (why)".
object OemChecks {
  private const val OP_AUTO_START = 10008
  private const val OP_SHOW_WHEN_LOCKED = 10020
  private const val OP_BACKGROUND_START_ACTIVITY = 10021

  fun snapshot(ctx: Context): Map<String, Any?> {
    val pkg = ctx.packageName
    val xiaomi = Build.MANUFACTURER.equals("Xiaomi", ignoreCase = true)
    return mapOf(
      "brand" to Build.BRAND,
      "miuiVersion" to prop("ro.miui.ui.version.name"),
      "hyperOsVersion" to prop("ro.mi.os.version.name"),
      "oneUiVersion" to prop("ro.build.version.oneui"),
      "installSource" to installSource(ctx),
      "restrictedSettings" to restrictedSettings(ctx),
      "backgroundRestricted" to backgroundRestricted(ctx),
      "standbyBucket" to standbyBucket(ctx),
      "miuiAutostart" to if (xiaomi) miuiOp(ctx, OP_AUTO_START) else null,
      "miuiAutostartReflect" to if (xiaomi) miuiAutostartReflect(ctx) else null,
      "miuiShowWhenLocked" to if (xiaomi) miuiOp(ctx, OP_SHOW_WHEN_LOCKED) else null,
      "miuiBackgroundStart" to if (xiaomi) miuiOp(ctx, OP_BACKGROUND_START_ACTIVITY) else null,
      "miuiNoRestrictions" to if (xiaomi) miuiNoRestrictions(ctx, pkg) else null,
    )
  }

  /** One line for the log, so each scenario run records the OEM state it ran under. */
  fun summary(ctx: Context): String =
    snapshot(ctx).entries.filter { it.value != null }.joinToString(" ") { "${it.key}=${it.value}" }

  private fun prop(name: String): String? =
    try {
      val value = Class.forName("android.os.SystemProperties")
        .getMethod("get", String::class.java)
        .invoke(null, name) as String
      value.ifEmpty { null }
    } catch (e: Exception) {
      null
    }

  private fun installSource(ctx: Context): String {
    if (Build.VERSION.SDK_INT < 33) return "unknown (API < 33)"
    return try {
      val info = ctx.packageManager.getInstallSourceInfo(ctx.packageName)
      val source = when (info.packageSource) {
        1 -> "other"
        2 -> "store"
        3 -> "local file"
        4 -> "downloaded file"
        else -> "unspecified"
      }
      "$source via ${info.installingPackageName ?: "?"}"
    } catch (e: Exception) {
      "unknown (${e.javaClass.simpleName})"
    }
  }

  private fun restrictedSettings(ctx: Context): String {
    if (Build.VERSION.SDK_INT < 33) return "unknown (API < 33)"
    return try {
      val ops = ctx.getSystemService(AppOpsManager::class.java)
      mode(ops.unsafeCheckOpNoThrow("android:access_restricted_settings", Process.myUid(), ctx.packageName))
    } catch (e: Exception) {
      "unknown (${e.javaClass.simpleName})"
    }
  }

  private fun backgroundRestricted(ctx: Context): Boolean =
    ctx.getSystemService(ActivityManager::class.java).isBackgroundRestricted

  private fun standbyBucket(ctx: Context): String {
    val bucket = ctx.getSystemService(UsageStatsManager::class.java).appStandbyBucket
    val name = when (bucket) {
      5 -> "exempted"
      10 -> "active"
      20 -> "working set"
      30 -> "frequent"
      40 -> "rare"
      45 -> "restricted"
      50 -> "never"
      else -> "?"
    }
    return "$bucket $name"
  }

  // Xiaomi's custom app-ops, read through the hidden checkOpNoThrow(int, int, String), as Telegram does.
  private fun miuiOp(ctx: Context, op: Int): String =
    try {
      val ops = ctx.getSystemService(AppOpsManager::class.java)
      val result = AppOpsManager::class.java
        .getMethod("checkOpNoThrow", Int::class.javaPrimitiveType, Int::class.javaPrimitiveType, String::class.java)
        .invoke(ops, op, Process.myUid(), ctx.packageName) as Int
      mode(result)
    } catch (e: Exception) {
      "unknown (${(e.cause ?: e).javaClass.simpleName})"
    }

  private fun miuiAutostartReflect(ctx: Context): String? =
    try {
      val result = Class.forName("android.miui.AppOpsUtils")
        .getMethod("getApplicationAutoStart", Context::class.java, String::class.java)
        .invoke(null, ctx, ctx.packageName) as Int
      if (result == 0) "granted" else "denied ($result)"
    } catch (e: ClassNotFoundException) {
      null
    } catch (e: Exception) {
      "unknown (${(e.cause ?: e).javaClass.simpleName})"
    }

  private fun miuiNoRestrictions(ctx: Context, pkg: String): String? =
    try {
      Settings.System.getString(ctx.contentResolver, "MILLET_NO_RESTRICT_APP")
        ?.let { list -> if (list.split(',').any { it.trim() == pkg }) "granted" else "denied" }
    } catch (e: Exception) {
      "unknown (${e.javaClass.simpleName})"
    }

  private fun mode(mode: Int) = when (mode) {
    AppOpsManager.MODE_ALLOWED -> "granted"
    AppOpsManager.MODE_IGNORED -> "denied"
    AppOpsManager.MODE_ERRORED -> "denied (errored)"
    AppOpsManager.MODE_DEFAULT -> "default"
    else -> "mode $mode"
  }

  /** The OEM screens. Each target lists candidates; the first that resolves opens. */
  fun intents(ctx: Context, target: String): List<Intent> {
    val pkg = ctx.packageName
    val label = ctx.applicationInfo.loadLabel(ctx.packageManager).toString()
    return when (target) {
      "miuiAutostart" -> listOf(
        Intent("miui.intent.action.OP_AUTO_START").addCategory(Intent.CATEGORY_DEFAULT),
        component("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"),
      )
      "miuiPermissions" -> listOf(
        Intent("miui.intent.action.APP_PERM_EDITOR").putExtra("extra_pkgname", pkg),
        component("com.miui.securitycenter", "com.miui.permcenter.permissions.PermissionsEditorActivity")
          .putExtra("extra_pkgname", pkg),
      )
      "miuiBatterySaver" -> listOf(
        component("com.miui.powerkeeper", "com.miui.powerkeeper.ui.HiddenAppsConfigActivity")
          .putExtra("package_name", pkg)
          .putExtra("package_label", label),
      )
      "samsungNeverSleeping" -> listOf(
        Intent("com.samsung.android.sm.ACTION_OPEN_CHECKABLE_LISTACTIVITY")
          .setPackage("com.samsung.android.lool")
          .putExtra("activity_type", 2),
      )
      "oemAutostart" -> listOf(
        component("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"),
        component("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"),
        component("com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"),
        component("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"),
        component("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"),
        component("com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity"),
      )
      else -> emptyList()
    }.plus(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$pkg")))
  }

  fun open(ctx: Context, target: String): Boolean {
    for (intent in intents(ctx, target)) {
      val name = intent.action ?: intent.component?.flattenToShortString()
      try {
        ctx.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        AlarmStore.log(ctx, "opened $target: $name")
        return true
      } catch (e: Exception) {
        AlarmStore.log(ctx, "can't open $target via $name: ${e.javaClass.simpleName}")
      }
    }
    return false
  }

  private fun component(pkg: String, cls: String) = Intent().setComponent(ComponentName(pkg, cls))
}
