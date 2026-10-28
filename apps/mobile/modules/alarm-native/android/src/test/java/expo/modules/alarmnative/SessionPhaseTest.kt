package expo.modules.alarmnative

import android.app.Application
import android.content.Context
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class SessionPhaseTest {
  private val ctx: Context get() = RuntimeEnvironment.getApplication()

  @Before fun ring() {
    AlarmStore.prefs(ctx).edit().clear().commit()
    AlarmStore.event(ctx, "ringStarted", newRing = JSONObject().put("id", "ring-1")
      .put("alarm", JSONObject().put("id", "morning")).put("startedAt", 123).put("phase", "ringing"))
  }

  @Test fun startMovesOnlyTheActiveRingIntoItsSession() {
    assertFalse(AlarmStore.setPhase(ctx, "stale-ring", "session"))
    assertEquals("ringing", AlarmStore.ring(ctx)!!.getString("phase"))
    assertTrue(AlarmStore.setPhase(ctx, "ring-1", "session"))
    assertEquals("session", AlarmStore.ring(ctx)!!.getString("phase"))
  }

  @Test fun aRestartedServiceRingsAgainUnderTheSameRing() {
    AlarmStore.setPhase(ctx, "ring-1", "session")
    assertTrue(AlarmStore.setPhase(ctx, null, "ringing"))
    assertEquals("ringing", AlarmStore.ring(ctx)!!.getString("phase"))
    assertEquals("ring-1", AlarmStore.ring(ctx)!!.getString("id"))
  }

  @Test fun noSignalChangesADismissedRing() {
    AlarmStore.finish(ctx)
    assertFalse(AlarmStore.setPhase(ctx, "ring-1", "session"))
    assertNull(AlarmStore.ring(ctx))
  }
}
