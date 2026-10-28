package expo.modules.alarmnative

import org.junit.Test
import org.junit.Assert.assertEquals
import org.json.JSONArray
import java.io.File
import java.time.Instant

class NextRingTest {
  @Test fun sharedFixtures() {
    val fixtures = JSONArray(File(System.getProperty("alarm.fixtures")).readText())
    for (i in 0 until fixtures.length()) {
      val f = fixtures.getJSONObject(i); val r = f.getJSONObject("rule"); val days = r.optJSONArray("repeatDays") ?: JSONArray()
      val actual = NextRing.calculate(r.getInt("hour"), r.getInt("minute"), (0 until days.length()).map { days.getInt(it) },
        r.optString("onceDate").takeIf { it.isNotEmpty() }, Instant.parse(f.getString("now")).toEpochMilli(), f.getString("zone"))
      assertEquals(f.getString("name"), if (f.isNull("expected")) null else Instant.parse(f.getString("expected")).toEpochMilli(), actual)
    }
  }
}
