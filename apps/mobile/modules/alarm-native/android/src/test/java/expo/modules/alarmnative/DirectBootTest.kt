package expo.modules.alarmnative

import android.app.Application
import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import android.os.UserManager
import org.robolectric.Shadows.shadowOf
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@org.robolectric.annotation.GraphicsMode(org.robolectric.annotation.GraphicsMode.Mode.NATIVE)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class DirectBootTest {
  private val originalZone = java.util.TimeZone.getDefault()
  @org.junit.After fun restoreZone() { java.util.TimeZone.setDefault(originalZone) }
  private val ctx: Context get() = RuntimeEnvironment.getApplication()
  private fun alarm(sound: String? = null) = JSONObject().put("id", "morning").put("enabled", true)
    .put("label", "Português").put("sound", sound ?: JSONObject.NULL)
    .put("rule", JSONObject().put("hour", 7).put("minute", 0).put("repeatDays", JSONArray("[1,2,3,4,5,6,7]")))

  @Before fun reset() {
    AlarmStore.prefs(ctx).edit().clear().commit()
    ctx.createDeviceProtectedStorageContext().filesDir.listFiles()?.forEach { it.delete() }
    shadowOf(ctx.getSystemService(UserManager::class.java)).setUserUnlocked(false)
  }

  @Test fun unavailableSoundDoesNotPreventScheduling() {
    AlarmScheduler.setAlarms(ctx, JSONArray().put(alarm("file:///no-longer-readable.ogg")), JSONObject())
    assertEquals(1, AlarmStore.alarms(ctx).length())
    assertTrue(AlarmStore.prefs(ctx).getLong("due.morning", 0) > 0)
    assertTrue(AlarmStore.alarms(ctx).getJSONObject(0).isNull("sound"))
  }
  @Test fun lockedScreenUsesMirroredAppearanceAndLocale() {
    AlarmStore.event(ctx, "ringStarted", newRing = JSONObject().put("id", "same-ring")
      .put("alarm", alarm()).put("startedAt", 123).put("phase", "ringing"))
    AlarmStore.setAppearance(ctx, JSONObject().put("background", "#120d1c")
      .put("foreground", "#ffffff").put("primary", "#c9b6ff"), "en")
    val activity = org.robolectric.Robolectric.buildActivity(LockedAlarmActivity::class.java).setup().get()
    val content = activity.findViewById<android.view.ViewGroup>(android.R.id.content)
    fun texts(view: android.view.View): List<android.widget.TextView> = when (view) {
      is android.widget.TextView -> listOf(view)
      is android.view.ViewGroup -> (0 until view.childCount).flatMap { texts(view.getChildAt(it)) }
      else -> emptyList()
    }
    val labels = texts(content)
    assertTrue(labels.any { it.text.toString() == "Unlock to start" })
    assertTrue(labels.any { it.text.toString() == "Português" })
    assertTrue(labels.any { it is android.widget.TextClock })
    assertEquals(android.graphics.Color.parseColor("#120d1c"),
      (content.getChildAt(0).background as android.graphics.drawable.ColorDrawable).color)
    assertFalse(labels.any { it.isClickable })
    assertEquals("same-ring", AlarmStore.ring(ctx)!!.getString("id"))
  }
  @Test fun unlockHandsOffTheSameRingWithoutDismissingIt() {
    val component = android.content.ComponentName(ctx.packageName, "${ctx.packageName}.MainActivity")
    val pm = shadowOf(ctx.packageManager)
    pm.addActivityIfNotPresent(component)
    pm.addIntentFilterForActivity(component, android.content.IntentFilter(android.content.Intent.ACTION_MAIN).apply {
      addCategory(android.content.Intent.CATEGORY_LAUNCHER)
    })
    AlarmStore.event(ctx, "ringStarted", newRing = JSONObject().put("id", "same-ring")
      .put("alarm", alarm()).put("startedAt", 123).put("phase", "ringing"))
    val controller = org.robolectric.Robolectric.buildActivity(LockedAlarmActivity::class.java).setup()
    val activity = controller.get()
    shadowOf(ctx.getSystemService(UserManager::class.java)).setUserUnlocked(true)
    activity.sendBroadcast(android.content.Intent(android.content.Intent.ACTION_USER_UNLOCKED))
    org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
    assertEquals(component, shadowOf(activity).nextStartedActivity?.component)
    assertTrue(activity.isFinishing)
    assertEquals("same-ring", AlarmStore.ring(ctx)!!.getString("id"))
    assertEquals(1, JSONArray(AlarmStore.prefs(ctx).getString("journal", "[]")).length())
    controller.pause().stop().destroy()
  }
  @Test fun soundCopySurvivesSourceRemoval() {
    val source = java.io.File(ctx.cacheDir, "sound.ogg").apply { writeText("sample sound") }
    val alarms = JSONArray().put(alarm(android.net.Uri.fromFile(source).toString()))
    AlarmScheduler.setAlarms(ctx, alarms, JSONObject())
    val saved = java.io.File(android.net.Uri.parse(AlarmStore.alarms(ctx).getJSONObject(0).getString("sound")).path!!)
    assertEquals(ctx.createDeviceProtectedStorageContext().filesDir, saved.parentFile)
    source.delete()
    // Reconciliation still carries the original URI from SQLite.
    AlarmScheduler.setAlarms(ctx, JSONArray().put(alarm(android.net.Uri.fromFile(source).toString())), JSONObject())
    assertEquals("sample sound", saved.readText())
  }

  private fun scheduleOnce() {
    java.util.TimeZone.setDefault(java.util.TimeZone.getTimeZone("UTC"))
    val once = alarm().put("rule", JSONObject().put("hour", 7).put("minute", 0).put("onceDate", "2026-10-28"))
    AlarmScheduler.setAlarms(ctx, JSONArray().put(once), JSONObject(), instant("06:59:00"))
  }
  private fun instant(time: String) = java.time.Instant.parse("2026-10-28T${time}Z").toEpochMilli()
  private fun boot(time: String) = AlarmScheduler.rearmAll(ctx, "LOCKED_BOOT_COMPLETED", instant(time))

  @Test fun missedAtExactlyThirtyMinutesRingsOnlyOnceAcrossBootBroadcasts() {
    scheduleOnce()
    boot("07:30:00")
    val id = AlarmStore.ring(ctx)!!.getString("id")
    AlarmScheduler.rearmAll(ctx, "BOOT_COMPLETED", instant("07:30:00"))
    assertEquals(id, AlarmStore.ring(ctx)!!.getString("id"))
    assertEquals("ringStarted", JSONArray(AlarmStore.prefs(ctx).getString("journal", "[]")).getJSONObject(0).getString("kind"))
    assertEquals(1, JSONArray(AlarmStore.prefs(ctx).getString("journal", "[]")).length())
  }

  @Test fun overThirtyMinutesIsJournaledAsMissedOnlyOnce() {
    scheduleOnce()
    boot("07:30:00.001"); boot("07:30:00.001")
    assertNull(AlarmStore.ring(ctx))
    val journal = JSONArray(AlarmStore.prefs(ctx).getString("journal", "[]"))
    assertEquals(1, journal.length())
    assertEquals("missed", journal.getJSONObject(0).getString("kind"))
  }

  @Test fun lockedBootRearmsFutureAlarmsAndRestoresAnActiveRing() {
    scheduleOnce()
    boot("06:59:30")
    assertNull(AlarmStore.ring(ctx))
    assertEquals(java.time.Instant.parse("2026-10-28T07:00:00Z").toEpochMilli(),
      AlarmStore.prefs(ctx).getLong("due.morning", 0))
    AlarmScheduler.fire(ctx, "morning", instant("07:00:00"))
    val id = AlarmStore.ring(ctx)!!.getString("id")
    boot("07:01:00")
    assertEquals(id, AlarmStore.ring(ctx)!!.getString("id"))
    assertEquals(1, JSONArray(AlarmStore.prefs(ctx).getString("journal", "[]")).length())
  }
}
