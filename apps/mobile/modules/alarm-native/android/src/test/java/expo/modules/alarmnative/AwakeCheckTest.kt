package expo.modules.alarmnative

import android.app.AlarmManager
import android.app.Application
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.ResolveInfo
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
class AwakeCheckTest {
  private val ctx: Context get() = RuntimeEnvironment.getApplication()
  private val dismissedAt = 1_000_000L

  private fun journal(): List<JSONObject> {
    val events = JSONArray(AlarmStore.prefs(ctx).getString("journal", "[]"))
    return (0 until events.length()).map { events.getJSONObject(it) }
  }
  private fun kinds() = journal().map { it.getString("kind") }
  private fun nextAlarmClock() = shadowOf(ctx.getSystemService(AlarmManager::class.java)).nextScheduledAlarm?.triggerAtTime

  @Before fun dismissARing() {
    // The prompt opens the app's launcher activity, which the test application lacks.
    shadowOf(ctx.packageManager).addResolveInfoForIntent(
      Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setPackage(ctx.packageName),
      ResolveInfo().apply { activityInfo = ActivityInfo().apply { packageName = ctx.packageName; name = "MainActivity" } },
    )
    AlarmStore.prefs(ctx).edit().clear().commit()
    AlarmStore.event(ctx, "ringStarted", newRing = JSONObject().put("id", "ring-1")
      .put("alarm", JSONObject().put("id", "morning")).put("startedAt", 123).put("phase", "session"))
  }

  private fun dismissWithCheck() {
    AlarmStore.finish(ctx, awakeCheckAfter = 300, now = dismissedAt)
    AwakeCheck.advance(ctx, now = dismissedAt, unlocked = true)
  }

  @Test fun aDismissalWithoutTheCheckSchedulesNothing() {
    AlarmStore.finish(ctx)
    assertNull(AwakeCheck.pending(ctx))
    assertNull(AlarmStore.ring(ctx))
  }

  @Test fun theCheckWaitsForItsDelayAsAnExactAlarmThenShows() {
    dismissWithCheck()
    assertNull(AlarmStore.ring(ctx))
    val check = AwakeCheck.pending(ctx)!!
    assertEquals("ring-1", check.getString("ringId"))
    assertEquals("morning", check.getJSONObject("alarm").getString("id"))
    assertEquals(dismissedAt + 300_000, nextAlarmClock())

    AwakeCheck.advance(ctx, now = dismissedAt + 299_999, unlocked = true)
    assertFalse(AwakeCheck.isShown(ctx))
    AwakeCheck.advance(ctx, now = dismissedAt + 300_000, unlocked = true)
    assertTrue(AwakeCheck.isShown(ctx))
    val shown = journal().last()
    assertEquals("awakeCheckShown", shown.getString("kind"))
    assertEquals("ring-1", shown.getString("ringId"))
    assertEquals("morning", shown.getString("alarmId"))
    // The timeout is an exact alarm too.
    assertEquals(dismissedAt + 360_000, nextAlarmClock())
  }

  @Test fun noAnswerInTimeFailsItAndRingsAgainWithANewRing() {
    dismissWithCheck()
    AwakeCheck.advance(ctx, now = dismissedAt + 300_000, unlocked = true)
    AwakeCheck.advance(ctx, now = dismissedAt + 359_999, unlocked = true)
    assertNull(AlarmStore.ring(ctx))
    AwakeCheck.advance(ctx, now = dismissedAt + 360_000, unlocked = true)
    assertNull(AwakeCheck.pending(ctx))
    val ring = AlarmStore.ring(ctx)!!
    assertNotEquals("ring-1", ring.getString("id"))
    assertEquals("morning", ring.getJSONObject("alarm").getString("id"))
    assertEquals(listOf("awakeCheckShown", "awakeCheckFailed", "ringStarted"), kinds().takeLast(3))
    assertEquals("ring-1", journal().first { it.getString("kind") == "awakeCheckFailed" }.getString("ringId"))
  }

  @Test fun anAnswerPassesOnlyTheCheckItBelongsTo() {
    dismissWithCheck()
    AwakeCheck.advance(ctx, now = dismissedAt + 300_000, unlocked = true)
    assertFalse(AwakeCheck.passed(ctx, "stale-check"))
    assertTrue(AwakeCheck.isShown(ctx))
    assertTrue(AwakeCheck.passed(ctx, AwakeCheck.pending(ctx)!!.getString("id")))
    assertNull(AwakeCheck.pending(ctx))
    assertEquals("awakeCheckPassed", kinds().last())
    AwakeCheck.advance(ctx, now = dismissedAt + 400_000, unlocked = true)
    assertNull(AlarmStore.ring(ctx))
  }

  @Test fun aCheckDueBeforeTheFirstUnlockRingsAgain() {
    dismissWithCheck()
    AwakeCheck.advance(ctx, now = dismissedAt + 300_000, unlocked = false)
    assertNull(AwakeCheck.pending(ctx))
    assertEquals(listOf("awakeCheckFailed", "ringStarted"), kinds().takeLast(2))
  }

  @Test fun aCheckDueDuringAnotherRingIsDropped() {
    dismissWithCheck()
    AlarmStore.event(ctx, "ringStarted", newRing = JSONObject().put("id", "ring-2")
      .put("alarm", JSONObject().put("id", "nap")).put("startedAt", 456).put("phase", "ringing"))
    AwakeCheck.advance(ctx, now = dismissedAt + 300_000, unlocked = true)
    assertNull(AwakeCheck.pending(ctx))
    assertEquals("ring-2", AlarmStore.ring(ctx)!!.getString("id"))
    assertEquals("ringStarted", kinds().last())
  }

  @Test fun aCheckDueWhileAnotherRingIsSnoozedIsDropped() {
    dismissWithCheck()
    AlarmStore.fire(ctx, JSONObject().put("id", "later"))
    val other = AlarmStore.ring(ctx)!!.getString("id")
    assertTrue(AlarmScheduler.snooze(ctx, other, 9, dismissedAt + 100_000))
    AwakeCheck.advance(ctx, now = dismissedAt + 300_000, unlocked = true)
    assertNull(AwakeCheck.pending(ctx))
    assertFalse(kinds().contains("awakeCheckShown"))
    assertEquals("snoozed", AlarmStore.ring(ctx)!!.getString("phase"))
  }
}
