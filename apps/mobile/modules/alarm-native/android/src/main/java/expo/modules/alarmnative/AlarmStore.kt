package expo.modules.alarmnative

import android.content.Context
import android.net.Uri
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

object AlarmStore {
  fun prefs(ctx: Context) = ctx.createDeviceProtectedStorageContext().getSharedPreferences("alarms", Context.MODE_PRIVATE)
  fun setAppearance(ctx: Context, colors: JSONObject, locale: String) {
    val safe = JSONObject()
    for (key in listOf("background", "foreground", "primary")) {
      val color = colors.getString(key)
      require(Regex("#[0-9a-fA-F]{6}").matches(color)) { "Invalid $key color" }
      safe.put(key, color)
    }
    check(prefs(ctx).edit().putString("colors", safe.toString())
      .putString("locale", if (locale == "en") "en" else "pt-BR").commit())
  }
  fun alarms(ctx: Context): JSONArray = JSONArray(prefs(ctx).getString("alarms", "[]"))
  fun ring(ctx: Context): JSONObject? = prefs(ctx).getString("ring", null)?.let { JSONObject(it) }
  fun isRinging(ctx: Context) = ring(ctx) != null
  fun log(ctx: Context, message: String) { android.util.Log.i("AlarmNative", message) }
  fun setting(ctx: Context, key: String): Int = when(key) {
    "rampSeconds" -> ring(ctx)?.getJSONObject("alarm")?.optInt(key, 30) ?: 30
    "vibrate" -> if (ring(ctx)?.getJSONObject("alarm")?.optBoolean("vibrate", true) != false) 1 else 0
    "leaveSeconds", "idleSeconds" -> JSONObject(prefs(ctx).getString("policy", "{}")).optInt(key, if(key == "leaveSeconds") 10 else 20)
    "forceMaxVolume", "directLaunch" -> 1
    else -> 0
  }
  fun sound(ctx: Context): Uri? = ring(ctx)?.getJSONObject("alarm")?.optString("soundFile")?.takeIf { it.isNotEmpty() }?.let { Uri.parse(it) }
  fun uuid7(): String {
    val random = UUID.randomUUID()
    return UUID((System.currentTimeMillis() shl 16) or 0x7000L or (random.mostSignificantBits and 0xfffL), random.leastSignificantBits).toString()
  }
  @Synchronized fun event(ctx: Context, kind: String, alarmId: String? = null, newRing: JSONObject? = null, clearRing: Boolean = false) {
    val active = newRing ?: ring(ctx)
    if (active == null && alarmId == null) return
    val events = JSONArray(prefs(ctx).getString("journal", "[]"))
    events.put(JSONObject().put("id", uuid7()).put("kind", kind).put("alarmId", alarmId ?: active?.getJSONObject("alarm")?.getString("id") ?: JSONObject.NULL)
      .put("ringId", active?.getString("id") ?: JSONObject.NULL).put("wallTime", System.currentTimeMillis()).put("elapsedRealtime", SystemClock.elapsedRealtime()))
    val edit = prefs(ctx).edit().putString("journal", events.toString())
    if (newRing != null) edit.putString("ring", newRing.toString())
    if (clearRing) edit.remove("ring")
    check(edit.commit())
    AlarmNativeModule.emit()
  }
  @Synchronized fun fire(ctx: Context, alarm: JSONObject) {
    if (isRinging(ctx)) { event(ctx, "absorbed", alarm.getString("id")); return }
    val ring = JSONObject().put("id", uuid7()).put("alarm", alarm).put("startedAt", System.currentTimeMillis()).put("phase", "ringing")
    event(ctx, "ringStarted", newRing = ring)
    AlarmService.start(ctx, "scheduled ring")
  }
  @Synchronized fun finish(ctx: Context) {
    if (!isRinging(ctx)) return
    event(ctx, "dismissed", clearRing = true)
  }
  @Synchronized fun ack(ctx: Context, ids: List<String>) {
    val old = JSONArray(prefs(ctx).getString("journal", "[]")); val kept = JSONArray()
    for (i in 0 until old.length()) if (old.getJSONObject(i).getString("id") !in ids) kept.put(old.getJSONObject(i))
    check(prefs(ctx).edit().putString("journal", kept.toString()).commit())
  }
}
