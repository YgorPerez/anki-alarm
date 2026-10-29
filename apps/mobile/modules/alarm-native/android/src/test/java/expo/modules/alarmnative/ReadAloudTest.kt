package expo.modules.alarmnative

import android.app.Application
import android.content.Context
import android.os.Looper
import android.speech.tts.TextToSpeech
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowTextToSpeech
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class ReadAloudTest {
  private val ctx: Context get() = RuntimeEnvironment.getApplication()
  private fun idle() = shadowOf(Looper.getMainLooper()).idle()

  @After fun release() { ReadAloud.release(); idle() }

  @Test fun aClipThatCantPlaySettlesAsNotPlayed() {
    var played: Boolean? = null
    ReadAloud.playClip(ctx, File(ctx.filesDir, "media/missing.mp3").toURI().toString()) { played = it }
    idle()
    assertEquals(false, played)
  }

  // Robolectric's engine reports each utterance done on the main looper.
  @Test fun speechWaitsForTheEngineAndEndsWhenItsDone() {
    var finished = false
    ReadAloud.speak(ctx, "gato", "pt-BR") { finished = true }
    idle()
    val engine = shadowOf(ShadowTextToSpeech.getLastTextToSpeechInstance())
    assertNull(engine.lastSpokenText)
    engine.onInitListener.onInit(TextToSpeech.SUCCESS)
    idle()
    assertEquals("gato", engine.lastSpokenText)
    assertTrue(finished)
  }

  @Test fun aNewReadingOrStopSettlesTheOneUnderWay() {
    var first = false
    var second = false
    ReadAloud.speak(ctx, "um", "pt-BR") { first = true }
    ReadAloud.speak(ctx, "dois", "pt-BR") { second = true }
    assertTrue(first)
    assertFalse(second)
    ReadAloud.stop()
    assertTrue(second)
  }
}
