package expo.modules.alarmnative

import expo.modules.alarmnative.RingPolicy.Fired
import expo.modules.alarmnative.RingPolicy.Sound
import org.junit.Assert.*
import org.junit.Test

class RingPolicyTest {
  private fun policy() = RingPolicy(leaveMs = 10_000, idleMs = 20_000)

  @Test fun aNewRingRampsAndARestartedOneRingsAtFull() {
    val fresh = policy().apply { start(0, fresh = true) }
    assertEquals(Sound.RAMP, fresh.sound)
    val restarted = policy().apply { start(0, fresh = false) }
    assertEquals(Sound.FULL, restarted.sound)
    assertFalse(restarted.inSession)
    assertNull(restarted.nextDeadline())
  }

  @Test fun startSilencesUntilNoAnswerComesForTheIdleTime() {
    val p = policy().apply { start(0, fresh = true); screenShown(0); sessionStarted(1_000) }
    assertEquals(Sound.SILENT, p.sound)
    assertEquals(emptyList<Fired>(), p.advance(20_999))
    assertEquals(Sound.SILENT, p.sound)
    assertEquals(listOf(Fired.IDLE), p.advance(21_000))
    assertEquals(Sound.FULL, p.sound)
    assertNull(p.nextDeadline())
  }

  @Test fun anAnswerQuietsTheRingAndRestartsTheIdleTime() {
    val p = policy().apply { start(0, fresh = true); screenShown(0); sessionStarted(0) }
    p.activity(15_000)
    assertEquals(35_000L, p.nextDeadline())
    p.advance(35_000)
    assertEquals(Sound.FULL, p.sound)
    p.activity(40_000)
    assertEquals(Sound.SILENT, p.sound)
    assertEquals(60_000L, p.nextDeadline())
  }

  @Test fun leavingBringsTheRingBackAtFullWithTheWayBack() {
    val p = policy().apply { start(0, fresh = true); screenShown(0); sessionStarted(0) }
    p.screenLeft(5_000)
    assertEquals(emptyList<Fired>(), p.advance(14_999))
    assertEquals(Sound.SILENT, p.sound)
    assertFalse(p.wayBack)
    assertEquals(listOf(Fired.LEFT), p.advance(15_000))
    assertEquals(Sound.FULL, p.sound)
    assertTrue(p.wayBack)
  }

  @Test fun comingBackInTimeCancelsTheLeaveAndComingBackLaterQuietsIt() {
    val p = policy().apply { start(0, fresh = true); screenShown(0); sessionStarted(0) }
    p.screenLeft(1_000)
    p.screenShown(9_000)
    assertEquals(29_000L, p.nextDeadline())
    p.screenLeft(10_000)
    p.advance(20_000)
    p.screenShown(30_000)
    assertFalse(p.wayBack)
    assertEquals(Sound.SILENT, p.sound)
    assertEquals(50_000L, p.nextDeadline())
  }

  @Test fun leavingBeforeStartCutsTheRampShort() {
    val p = policy().apply { start(0, fresh = true); screenShown(0) }
    p.screenLeft(2_000)
    assertEquals(listOf(Fired.LEFT), p.advance(12_000))
    assertEquals(Sound.FULL, p.sound)
    p.screenShown(13_000)
    assertEquals(Sound.FULL, p.sound)
  }

  @Test fun answersOutsideASessionChangeNothing() {
    val p = policy().apply { start(0, fresh = true) }
    p.activity(1_000)
    assertEquals(Sound.RAMP, p.sound)
    assertNull(p.nextDeadline())
  }

  @Test fun timersThatBothPassFireTogether() {
    val p = policy().apply { start(0, fresh = true); screenShown(0); sessionStarted(0) }
    p.screenLeft(15_000)
    assertEquals(listOf(Fired.IDLE, Fired.LEFT), p.advance(60_000))
    assertNull(p.nextDeadline())
  }
}
