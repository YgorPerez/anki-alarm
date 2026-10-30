package expo.modules.alarmnative

import org.junit.Test
import org.junit.Assert.assertEquals
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant

class NextRingTest {
  @Test fun sharedFixtures() {
    val fixtures = JSONArray(File(System.getProperty("alarm.fixtures")).readText())
    for (i in 0 until fixtures.length()) {
      val f = fixtures.getJSONObject(i)
      // The alarm as setAlarms receives it from JS.
      val alarm = JSONObject().put("rule", f.getJSONObject("rule"))
        .put("skip", if (f.has("skip")) Instant.parse(f.getString("skip")).toEpochMilli() else JSONObject.NULL)
      val actual = NextRing.of(alarm, Instant.parse(f.getString("now")).toEpochMilli(), f.getString("zone"))
      assertEquals(f.getString("name"), if (f.isNull("expected")) null else Instant.parse(f.getString("expected")).toEpochMilli(), actual)
    }
  }
}
