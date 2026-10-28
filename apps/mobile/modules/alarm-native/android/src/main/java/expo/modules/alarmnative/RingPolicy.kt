package expo.modules.alarmnative

/**
 * The ring's volume policy (ADR 0005), free of Android so it can be tested on the JVM. Native runs
 * it from the screen's visibility and JS's session signals, so a stalled JS thread can't keep the
 * alarm quiet. Times are `elapsedRealtime` milliseconds; the service calls [advance] at
 * [nextDeadline].
 */
class RingPolicy(private val leaveMs: Long, private val idleMs: Long) {
  enum class Sound { RAMP, FULL, SILENT }
  enum class Fired { IDLE, LEFT }

  var sound = Sound.FULL
    private set
  /** Whether the way-back notification should be showing. */
  var wayBack = false
    private set
  var inSession = false
    private set
  private var leftAt: Long? = null
  private var idleFrom: Long? = null

  /** A fresh ring ramps up; a ring taken over after a kill or reboot rings at full, out of session. */
  fun start(now: Long, fresh: Boolean) {
    sound = if (fresh) Sound.RAMP else Sound.FULL
    inSession = false
    wayBack = false
    leftAt = null
    idleFrom = null
  }

  fun screenShown(now: Long) {
    leftAt = null
    wayBack = false
    if (inSession) quiet(now)
  }

  fun screenLeft(now: Long) {
    leftAt = now
  }

  /** Start: sound and vibration stop until the screen is left or no answer comes. */
  fun sessionStarted(now: Long) {
    inSession = true
    quiet(now)
  }

  /** Any tap or answer in the session quiets the ring again and restarts the idle time. */
  fun activity(now: Long) {
    if (inSession) quiet(now)
  }

  fun nextDeadline(): Long? = listOfNotNull(idleDeadline(), leaveDeadline()).minOrNull()

  /** Applies every timer due by [now], in order, and returns the ones that fired. */
  fun advance(now: Long): List<Fired> {
    val due = listOfNotNull(idleDeadline()?.let { it to Fired.IDLE }, leaveDeadline()?.let { it to Fired.LEFT })
      .filter { it.first <= now }.sortedBy { it.first }.map { it.second }
    for (fired in due) {
      sound = Sound.FULL
      when (fired) {
        Fired.IDLE -> idleFrom = null
        Fired.LEFT -> { leftAt = null; wayBack = true }
      }
    }
    return due
  }

  private fun quiet(now: Long) {
    sound = Sound.SILENT
    idleFrom = now
  }

  private fun idleDeadline() = idleFrom?.plus(idleMs)
  private fun leaveDeadline() = leftAt?.plus(leaveMs)
}
