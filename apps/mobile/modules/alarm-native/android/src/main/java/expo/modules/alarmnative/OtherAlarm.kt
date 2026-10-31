package expo.modules.alarmnative

import android.app.ActivityOptions
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Build
import android.util.Base64
import java.io.ByteArrayOutputStream
import kotlin.math.roundToInt

/**
 * Another app's next alarm, read only. Android reports just the soonest `setAlarmClock` alarm across
 * all apps, so this is null whenever one of ours comes first.
 */
object OtherAlarm {
  private fun next(context: Context): AlarmManager.AlarmClockInfo? =
    context.getSystemService(AlarmManager::class.java).nextAlarmClock
      ?.takeUnless { it.showIntent?.creatorPackage == context.packageName }

  // Package visibility can hide the app; the UI then calls it "another app", with a generic icon.
  private fun label(context: Context, pkg: String?): String? = try {
    pkg?.let { context.packageManager.run { getApplicationLabel(getApplicationInfo(it, 0)).toString() } }
  } catch (_: Exception) {
    null
  }

  private const val ICON_DP = 40

  // Read each second while the tab shows, so the last app's icon is kept rather than drawn again.
  private var lastIcon: Pair<String, String?>? = null

  private fun icon(context: Context, pkg: String?): String? {
    if (pkg == null) return null
    lastIcon?.takeIf { it.first == pkg }?.let { return it.second }
    return drawIcon(context, pkg).also { lastIcon = pkg to it }
  }

  private fun drawIcon(context: Context, pkg: String): String? = try {
    val drawable = context.packageManager.getApplicationIcon(pkg)
    val size = (ICON_DP * context.resources.displayMetrics.density).roundToInt()
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    drawable.setBounds(0, 0, size, size)
    drawable.draw(Canvas(bitmap))
    val png = ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    "data:image/png;base64," + Base64.encodeToString(png.toByteArray(), Base64.NO_WRAP)
  } catch (_: Exception) {
    null
  }

  fun read(context: Context): Map<String, Any?>? = next(context)?.let { info ->
    val pkg = info.showIntent?.creatorPackage
    mapOf("at" to info.triggerTime.toDouble(), "app" to label(context, pkg), "icon" to icon(context, pkg))
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
