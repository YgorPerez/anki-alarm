package expo.modules.alarmnative

import android.app.Application
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ServiceController
import org.robolectric.annotation.Config
import java.time.Duration

/** #42: once a ring starts, only dismissal ends it. Drives the real service through its signals. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class InescapableRingTest {
  private val ctx: Context get() = RuntimeEnvironment.getApplication()
  private var controller: ServiceController<AlarmService>? = null
  private val originalZone = java.util.TimeZone.getDefault()

  @Before fun reset() {
    AlarmStore.prefs(ctx).edit().clear().commit()
    // The app's launcher activity, which the ringing notification opens.
    val main = android.content.ComponentName(ctx.packageName, "${ctx.packageName}.MainActivity")
    shadowOf(ctx.packageManager).apply {
      addActivityIfNotPresent(main)
      addIntentFilterForActivity(main, android.content.IntentFilter(Intent.ACTION_MAIN).apply {
        addCategory(Intent.CATEGORY_LAUNCHER)
      })
    }
  }

  @After fun stop() {
    controller?.get()?.dismiss()
    controller?.destroy()
    java.util.TimeZone.setDefault(originalZone)
  }

  private fun ring(phase: String = "ringing") = AlarmStore.event(ctx, "ringStarted", newRing = JSONObject()
    .put("id", "ring-1").put("alarm", JSONObject().put("id", "morning").put("rampSeconds", 30))
    .put("startedAt", 123).put("phase", phase))

  private fun start(reason: String?): AlarmService {
    val intent = reason?.let { Intent(ctx, AlarmService::class.java).putExtra("reason", it) }
    val c = controller ?: Robolectric.buildService(AlarmService::class.java, intent).create().also { controller = it }
    c.withIntent(intent).startCommand(0, 1)
    return c.get()
  }

  private fun idle(seconds: Long) = shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(seconds))
  private fun journal() = JSONArray(AlarmStore.prefs(ctx).getString("journal", "[]")).let { j ->
    (0 until j.length()).map { j.getJSONObject(it) } }
  private fun wayBackShown() = shadowOf(ctx.getSystemService(NotificationManager::class.java))
    .allNotifications.size > 1

  private fun inSession(): AlarmService {
    ring()
    val service = start(AlarmService.REASON_SCHEDULED)
    service.onScreenShown()
    AlarmStore.setPhase(ctx, "ring-1", "session")
    service.startSession()
    idle(1)
    return service
  }

  @Test fun aNewRingRampsUpFromQuiet() {
    ring()
    val service = start(AlarmService.REASON_SCHEDULED)
    assertTrue(service.level < 0.1f)
    idle(30)
    assertEquals(1f, service.level, 0f)
  }

  @Test fun leavingTheScreenBringsItBackAtFullAfterTenSecondsWithTheWayBack() {
    val service = inSession()
    assertEquals(0f, service.level, 0f)
    service.onScreenLeft()
    idle(9)
    assertEquals(0f, service.level, 0f)
    assertFalse(wayBackShown())
    idle(1)
    assertEquals(1f, service.level, 0f)
    assertTrue(wayBackShown())
    service.onScreenShown()
    assertEquals(0f, service.level, 0f)
    assertFalse(wayBackShown())
  }

  @Test fun noAnswerForTheIdleTimeRingsAtFullAndAnAnswerQuietsIt() {
    val service = inSession()
    idle(18)
    service.onActivity()
    idle(19)
    assertEquals(0f, service.level, 0f)
    idle(1)
    assertEquals(1f, service.level, 0f)
    service.onActivity()
    assertEquals(0f, service.level, 0f)
  }

  @Test fun theWatchdogOnALiveRingKeepsItsSession() {
    val service = inSession()
    // Swipe-away keeps the process; the watchdog then starts the same service again.
    service.onTaskRemoved(null)
    start("watchdog")
    assertEquals(0f, service.level, 0f)
    assertEquals("session", AlarmStore.ring(ctx)!!.getString("phase"))
    assertEquals(listOf("ringStarted"), journal().map { it.getString("kind") })
  }

  @Test fun aServiceRestartedAfterAKillRingsTheSameRingAtFull() {
    ring(phase = "session")
    val service = start(null) // START_STICKY redelivers a null intent
    assertEquals(1f, service.level, 0f)
    assertEquals("ringing", AlarmStore.ring(ctx)!!.getString("phase"))
    val restarted = journal().last()
    assertEquals("serviceRestarted", restarted.getString("kind"))
    assertEquals("ring-1", restarted.getString("ringId"))
  }

  @Test fun aRebootMidSessionRingsAgainAtBootWithTheSameRing() {
    ring(phase = "session")
    AlarmScheduler.rearmAll(ctx, "LOCKED_BOOT_COMPLETED")
    val started = shadowOf(ctx as Application).nextStartedService
    assertEquals(AlarmService::class.java.name, started.component!!.className)
    val service = start(started.getStringExtra("reason"))
    assertEquals(1f, service.level, 0f)
    assertEquals("ring-1", AlarmStore.ring(ctx)!!.getString("id"))
    assertEquals(listOf("ringStarted", "serviceRestarted"), journal().map { it.getString("kind") })
  }

  @Test fun anAlarmDueDuringARingIsFoldedIntoIt() {
    java.util.TimeZone.setDefault(java.util.TimeZone.getTimeZone("UTC"))
    fun alarm(id: String, minute: Int) = JSONObject().put("id", id).put("enabled", true).put("label", id)
      .put("rule", JSONObject().put("hour", 7).put("minute", minute).put("repeatDays", JSONArray("[1,2,3,4,5,6,7]")))
    val at = { time: String -> java.time.Instant.parse("2026-10-28T${time}Z").toEpochMilli() }
    AlarmScheduler.setAlarms(ctx, JSONArray().put(alarm("early", 0)).put(alarm("late", 5)), JSONObject(), at("06:59:00"))
    AlarmScheduler.fire(ctx, "early", at("07:00:00"))
    val ringId = AlarmStore.ring(ctx)!!.getString("id")
    AlarmScheduler.fire(ctx, "late", at("07:05:00"))
    assertEquals(ringId, AlarmStore.ring(ctx)!!.getString("id"))
    assertEquals("early", AlarmStore.ring(ctx)!!.getJSONObject("alarm").getString("id"))
    val absorbed = journal().last()
    assertEquals("absorbed", absorbed.getString("kind"))
    assertEquals("late", absorbed.getString("alarmId"))
    assertEquals(ringId, absorbed.getString("ringId"))
    // The folded alarm re-arms for its next occurrence.
    assertEquals(at("07:05:00") + 86_400_000, AlarmStore.prefs(ctx).getLong("due.late", 0))
  }
}
