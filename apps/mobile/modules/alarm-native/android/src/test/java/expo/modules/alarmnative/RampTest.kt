package expo.modules.alarmnative

import org.junit.Assert.assertEquals
import org.junit.Test

class RampTest {
  @Test fun risesEvenlyInDecibelsFromNearSilentToFull() {
    assertEquals(0.01f, Ramp.level(0, 30), 1e-4f)
    assertEquals(0.1f, Ramp.level(15_000, 30), 1e-4f)
    assertEquals(1f, Ramp.level(30_000, 30), 1e-4f)
    assertEquals(1f, Ramp.level(90_000, 30), 1e-4f)
  }

  @Test fun noRampRingsAtFullVolumeAtOnce() {
    assertEquals(1f, Ramp.level(0, 0), 0f)
  }
}
