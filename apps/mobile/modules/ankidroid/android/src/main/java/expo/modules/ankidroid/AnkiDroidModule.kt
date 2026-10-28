package expo.modules.ankidroid

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.ActivityCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * AnkiDroid's ContentProvider, apart from the alarm (ADR 0005). JS re-checks `status()` on every
 * visit and resume: the permission can go missing when AnkiDroid is installed after this app.
 */
class AnkiDroidModule : Module() {
  private val context: Context get() = requireNotNull(appContext.reactContext)
  private val prefs get() = context.getSharedPreferences("ankidroid", Context.MODE_PRIVATE)

  override fun definition() = ModuleDefinition {
    Name("AnkiDroid")

    /** null when AnkiDroid isn't installed. */
    Function("status") {
      val info = try {
        context.packageManager.getPackageInfo(AnkiDroidReader.PACKAGE, 0)
      } catch (e: PackageManager.NameNotFoundException) {
        return@Function null
      }
      @Suppress("DEPRECATION")
      val versionCode = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
      mapOf(
        "versionCode" to versionCode.toDouble(),
        "permission" to if (granted()) "granted" else "denied",
      )
    }

    /** Shows the runtime prompt, or AnkiDroid's permission in App info once Android stops showing it. */
    Function("requestPermission") {
      if (granted()) return@Function "granted"
      val activity = appContext.currentActivity
      val asked = prefs.getBoolean("asked", false)
      if (activity != null && (!asked || ActivityCompat.shouldShowRequestPermissionRationale(activity, AnkiDroidReader.PERMISSION))) {
        prefs.edit().putBoolean("asked", true).apply()
        activity.runOnUiThread { ActivityCompat.requestPermissions(activity, arrayOf(AnkiDroidReader.PERMISSION), 56) }
        "prompted"
      } else {
        context.startActivity(
          Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
        "settings"
      }
    }

    AsyncFunction("decks") { promise: Promise ->
      provider(promise) { AnkiDroidReader(context.contentResolver).decks().toString() }
    }

    AsyncFunction("readDeck") { deckId: Double, promise: Promise ->
      provider(promise) { AnkiDroidReader(context.contentResolver).read(deckId.toLong()).toString() }
    }

    AsyncFunction("cards") { noteIds: List<Double>, promise: Promise ->
      provider(promise) { AnkiDroidReader(context.contentResolver).cards(noteIds.map { it.toLong() }).toString() }
    }

    /** Sync back: one answer, then the card as AnkiDroid has it afterwards ("null" when it's gone). */
    AsyncFunction("answer") { noteId: Double, ord: Int, ease: Int, timeTakenMs: Double, promise: Promise ->
      provider(promise) {
        AnkiDroidReader(context.contentResolver).answer(noteId.toLong(), ord, ease, timeTakenMs.toLong())?.toString() ?: "null"
      }
    }
  }

  private fun granted() = context.checkSelfPermission(AnkiDroidReader.PERMISSION) == PackageManager.PERMISSION_GRANTED

  /** Maps the provider's failures to codes the screens explain. */
  private fun provider(promise: Promise, read: () -> String) {
    try {
      promise.resolve(read())
    } catch (e: SecurityException) {
      promise.reject("ERR_ANKIDROID_PERMISSION", "AnkiDroid's API permission is missing", e)
    } catch (e: IllegalStateException) {
      // AnkiDroid's storage isn't set up yet (its first run never finished).
      promise.reject("ERR_ANKIDROID_UNAVAILABLE", "AnkiDroid's collection isn't available", e)
    } catch (e: Exception) {
      promise.reject("ERR_ANKIDROID", e.message ?: "AnkiDroid's API failed", e)
    }
  }
}
