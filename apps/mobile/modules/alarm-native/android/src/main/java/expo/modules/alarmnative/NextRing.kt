package expo.modules.alarmnative

import org.json.JSONArray
import org.json.JSONObject
import java.time.*

object NextRing {
  fun calculate(hour: Int, minute: Int, days: List<Int>, onceDate: String?, now: Long, zone: String): Long? {
    val tz = ZoneId.of(zone)
    val start = onceDate?.let { LocalDate.parse(it) } ?: Instant.ofEpochMilli(now).atZone(tz).toLocalDate()
    for (offset in 0..(if (onceDate != null) 0 else 7)) {
      val date = start.plusDays(offset.toLong())
      if (onceDate == null && date.dayOfWeek.value !in days) continue
      val at = date.atTime(hour, minute).atZone(tz).toInstant().toEpochMilli()
      if (at > now) return at
    }
    return null
  }

  /** The alarm's next ring, passing over its skipped occurrence (Core's `upcomingRing`). */
  fun of(alarm: JSONObject, now: Long, zone: String): Long? {
    val r = alarm.getJSONObject("rule"); val days = r.optJSONArray("repeatDays") ?: JSONArray()
    val ring = { after: Long -> calculate(r.getInt("hour"), r.getInt("minute"), (0 until days.length()).map { days.getInt(it) },
      r.optString("onceDate").takeIf { it.isNotEmpty() }, after, zone) }
    val skip = if (alarm.isNull("skip")) null else alarm.getLong("skip")
    val at = ring(now)
    return if (at != null && at == skip) ring(at) else at
  }
}
