package expo.modules.alarmnative

import android.app.Application
import android.content.Intent
import android.media.RingtoneManager
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class SoundsTest {
  private val ctx get() = RuntimeEnvironment.getApplication()

  @Test fun systemPickerOffersAlarmSoundsWithoutASilentChoice() {
    val uri = "content://media/internal/audio/media/7"
    val intent = Sounds.picker("ringtone", uri)
    assertEquals(RingtoneManager.ACTION_RINGTONE_PICKER, intent.action)
    assertEquals(RingtoneManager.TYPE_ALARM, intent.getIntExtra(RingtoneManager.EXTRA_RINGTONE_TYPE, -1))
    assertTrue(intent.getBooleanExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, false))
    assertFalse(intent.getBooleanExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, true))
    @Suppress("DEPRECATION")
    val current: Uri? = intent.getParcelableExtra(RingtoneManager.EXTRA_RINGTONE_EXISTING_URI)
    assertEquals(Uri.parse(uri), current)
  }

  @Test fun documentPickerAcceptsOpenableAudioAndCancellationKeepsNoNewChoice() {
    val intent = Sounds.picker("file", null)
    assertEquals(Intent.ACTION_OPEN_DOCUMENT, intent.action)
    assertEquals("audio/*", intent.type)
    assertTrue(intent.hasCategory(Intent.CATEGORY_OPENABLE))
    assertNull(Sounds.picked(ctx, "file", null))
    assertNull(Sounds.picked(ctx, "ringtone", Intent()))
  }

  @Test fun selectedRingtoneIsCopiedBeforeLockedBoot() {
    AlarmStore.prefs(ctx).edit().clear().commit()
    val source = java.io.File(ctx.cacheDir, "picked.wav").apply { writeText("ringtone bytes") }
    val uri = Uri.fromFile(source)
    val choice = JSONObject().put("kind", "ringtone").put("uri", uri.toString()).put("title", "My ringtone")
    val alarm = JSONObject().put("id", "picked").put("sound", choice).put("enabled", true)
      .put("rule", JSONObject().put("hour", 7).put("minute", 0).put("repeatDays", JSONArray("[1,2,3,4,5,6,7]")))
    AlarmScheduler.setAlarms(ctx, JSONArray().put(alarm), JSONObject())
    val saved = AlarmStore.alarms(ctx).getJSONObject(0)
    source.delete()
    val copy = java.io.File(Uri.parse(saved.getString("soundFile")).path!!)
    assertEquals(ctx.createDeviceProtectedStorageContext().filesDir, copy.parentFile)
    assertEquals("ringtone bytes", copy.readText())
    assertEquals("ringtone", saved.getJSONObject("sound").getString("kind"))
  }
}
