package expo.modules.alarmnative

import kotlin.math.pow

/** The ring's volume ramp: linear in decibels, -40 dB to 0 dB, so loudness grows evenly. */
object Ramp {
  private const val FROM_DB = -40f

  fun level(elapsedMs: Long, rampSeconds: Int): Float {
    if (rampSeconds <= 0) return 1f
    val done = (elapsedMs / (rampSeconds * 1000f)).coerceIn(0f, 1f)
    return 10f.pow(FROM_DB * (1 - done) / 20)
  }
}
