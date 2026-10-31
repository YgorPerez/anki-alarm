package expo.modules.alarmnative

import android.app.AlarmManager
import android.app.Application
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class OtherAlarmTest {
  private val ctx: Context get() = RuntimeEnvironment.getApplication()
  private val at = 1_800_000_000_000L
  private fun schedule(creator: String) {
    val show = PendingIntent.getActivity(ctx, 0, Intent("show"), PendingIntent.FLAG_IMMUTABLE)
    shadowOf(show).setCreatorPackage(creator)
    val fire = PendingIntent.getBroadcast(ctx, 1, Intent("fire"), PendingIntent.FLAG_IMMUTABLE)
    ctx.getSystemService(AlarmManager::class.java).setAlarmClock(AlarmManager.AlarmClockInfo(at, show), fire)
  }

  @Test fun nothingScheduledReadsNull() {
    assertNull(OtherAlarm.read(ctx))
    assertFalse(OtherAlarm.open(ctx))
  }

  @Test fun ourOwnAlarmIsHidden() {
    schedule(ctx.packageName)
    assertNull(OtherAlarm.read(ctx))
    assertFalse(OtherAlarm.open(ctx))
  }

  @Test fun anotherAppsAlarmReadsItsTimeWithoutANameWhenHidden() {
    schedule("com.example.clock")
    val alarm = OtherAlarm.read(ctx)!!
    assertEquals(at, alarm.getLong("at"))
    assertTrue(alarm.isNull("app"))
  }

  @Test fun openingSendsTheOtherAppsIntent() {
    schedule("com.example.clock")
    assertTrue(OtherAlarm.open(ctx))
    assertEquals("show", shadowOf(ctx as Application).nextStartedActivity.action)
  }
}
