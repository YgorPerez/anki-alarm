package expo.modules.alarmnative

import android.app.AlarmManager
import android.app.Application
import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class SnoozeTest {
  private val ctx: Context get() = RuntimeEnvironment.getApplication()
  private val now = 1_800_000_000_000L
  private val nineMinutes = 9 * 60_000L
  private fun journal() = JSONArray(AlarmStore.prefs(ctx).getString("journal", "[]")).let { events ->
    (0 until events.length()).map { events.getJSONObject(it).getString("kind") }
  }
  private fun ring() = AlarmStore.ring(ctx)!!
  private fun nextAlarmAt() = shadowOf(ctx.getSystemService(AlarmManager::class.java)).nextScheduledAlarm?.triggerAtTime

  @Before fun ringing() {
    AlarmStore.prefs(ctx).edit().clear().commit()
    // The exact alarm's show intent opens the app's launcher activity.
    val launcher = android.content.ComponentName(ctx.packageName, "${ctx.packageName}.MainActivity")
    shadowOf(ctx.packageManager).apply {
      addActivityIfNotPresent(launcher)
      addIntentFilterForActivity(launcher, android.content.IntentFilter(android.content.Intent.ACTION_MAIN).apply {
        addCategory(android.content.Intent.CATEGORY_LAUNCHER)
      })
    }
    AlarmStore.event(ctx, "ringStarted", newRing = JSONObject().put("id", "ring-1")
      .put("alarm", JSONObject().put("id", "morning")).put("startedAt", 123).put("phase", "ringing"))
  }

  @Test fun snoozeSilencesTheActiveRingCountsItAndArmsAnExactAlarm() {
    assertFalse(AlarmScheduler.snooze(ctx, "stale-ring", 9, now))
    assertTrue(AlarmScheduler.snooze(ctx, "ring-1", 9, now))
    assertEquals("snoozed", ring().getString("phase"))
    assertEquals(1, ring().getInt("snoozes"))
    assertEquals(now + nineMinutes, ring().getLong("snoozedUntil"))
    assertFalse(AlarmStore.isRinging(ctx))
    assertEquals(now + nineMinutes, nextAlarmAt())
    assertEquals(listOf("ringStarted", "snoozed"), journal())
    // A second snooze while snoozed changes nothing.
    assertFalse(AlarmScheduler.snooze(ctx, "ring-1", 9, now + 1000))
    assertEquals(1, ring().getInt("snoozes"))
  }

  @Test fun theSnoozeAlarmRingsTheSameRingAgainAndKeepsTheCount() {
    AlarmScheduler.snooze(ctx, "ring-1", 9, now)
    AlarmScheduler.endSnooze(ctx)
    assertEquals("ring-1", ring().getString("id"))
    assertEquals("ringing", ring().getString("phase"))
    assertFalse(ring().has("snoozedUntil"))
    assertTrue(AlarmStore.isRinging(ctx))
    assertEquals(listOf("ringStarted", "snoozed", "snoozeEnded"), journal())
    // Wake-up stats (#59) count snoozes by the ring id, which a snooze keeps.
    val events = JSONArray(AlarmStore.prefs(ctx).getString("journal", "[]"))
    for (i in 0 until events.length()) {
      assertEquals("ring-1", events.getJSONObject(i).getString("ringId"))
      assertEquals("morning", events.getJSONObject(i).getString("alarmId"))
    }
    AlarmScheduler.snooze(ctx, "ring-1", 5, now + nineMinutes)
    assertEquals(2, ring().getInt("snoozes"))
  }

  @Test fun aRebootReArmsTheSnoozeOrRingsWhenItAlreadyEnded() {
    AlarmScheduler.snooze(ctx, "ring-1", 9, now)
    AlarmScheduler.rearmAll(ctx, "LOCKED_BOOT_COMPLETED", now + 60_000)
    assertEquals("snoozed", ring().getString("phase"))
    assertEquals(now + nineMinutes, nextAlarmAt())
    AlarmScheduler.rearmAll(ctx, "LOCKED_BOOT_COMPLETED", now + nineMinutes + 1)
    assertEquals("ringing", ring().getString("phase"))
    assertEquals("ring-1", ring().getString("id"))
  }

  @Test fun answerNowEndsTheSnoozeIntoTheSession() {
    assertFalse(AlarmStore.answerNow(ctx, "ring-1"))
    AlarmScheduler.snooze(ctx, "ring-1", 9, now)
    assertTrue(AlarmStore.answerNow(ctx, "ring-1"))
    assertEquals("session", ring().getString("phase"))
    assertEquals(1, ring().getInt("snoozes"))
    assertFalse(ring().has("snoozedUntil"))
    assertEquals(listOf("ringStarted", "snoozed", "snoozeEnded"), journal())
  }

  @Test fun anAlarmDueDuringASnoozeIsFoldedIntoTheRing() {
    AlarmScheduler.snooze(ctx, "ring-1", 9, now)
    AlarmStore.fire(ctx, JSONObject().put("id", "second"))
    assertEquals("ring-1", ring().getString("id"))
    assertEquals("snoozed", ring().getString("phase"))
    assertEquals(listOf("ringStarted", "snoozed", "absorbed"), journal())
  }

  @Test fun dismissingASnoozedRingEndsIt() {
    AlarmScheduler.snooze(ctx, "ring-1", 9, now)
    AlarmStore.finish(ctx)
    assertNull(AlarmStore.ring(ctx))
  }
}
