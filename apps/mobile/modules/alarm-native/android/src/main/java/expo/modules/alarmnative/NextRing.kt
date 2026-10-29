package expo.modules.alarmnative

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
}
