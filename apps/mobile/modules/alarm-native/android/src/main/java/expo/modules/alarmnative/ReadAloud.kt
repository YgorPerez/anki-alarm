package expo.modules.alarmnative

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale

/**
 * Read aloud (ADR 0005): TTS or a card's own clip on the alarm stream, so it's heard in silent and
 * Do Not Disturb. One reading at a time: a new one, `stop()` or the ring's end settles the last.
 * While it reads, the ring stays silent and its idle timer waits. Main thread only.
 */
object ReadAloud {
  private val main = Handler(Looper.getMainLooper())
  private var tts: TextToSpeech? = null
  private var ttsReady = false
  private var waitingForTts: (() -> Unit)? = null
  private var player: MediaPlayer? = null
  private var reading = 0
  private var settle: ((Boolean) -> Unit)? = null

  private fun attributes(content: Int) =
    AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(content).build()

  /** Speaks `text` in `language` (a BCP 47 tag), or the engine's default when it lacks it. */
  fun speak(ctx: Context, text: String, language: String, finished: () -> Unit) {
    val id = begin { finished() }
    val say = say@{
      val engine = tts ?: return@say end(id, false)
      val locale = Locale.forLanguageTag(language)
      if (engine.isLanguageAvailable(locale) >= TextToSpeech.LANG_AVAILABLE) engine.language = locale
      else AlarmStore.log(ctx, "read aloud: no TTS voice for $language, using the default")
      if (engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, "$id") != TextToSpeech.SUCCESS) end(id, false)
    }
    if (ttsReady) say() else {
      waitingForTts = say
      if (tts == null) {
        lateinit var created: TextToSpeech
        // A released engine's late start must not mark the next one ready.
        created = TextToSpeech(ctx.applicationContext) { status -> main.post { if (tts === created) onTtsReady(ctx, status) } }
        tts = created
      }
    }
  }

  private fun onTtsReady(ctx: Context, status: Int) {
    val engine = tts ?: return
    val waiting = waitingForTts
    waitingForTts = null
    if (status != TextToSpeech.SUCCESS) {
      AlarmStore.log(ctx, "read aloud: TTS failed to start ($status)")
      engine.shutdown()
      tts = null
      waiting?.invoke()
      return
    }
    ttsReady = true
    engine.setAudioAttributes(attributes(AudioAttributes.CONTENT_TYPE_SPEECH))
    engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
      override fun onStart(utteranceId: String) {}
      override fun onDone(utteranceId: String) { main.post { end(utteranceId.toIntOrNull(), true) } }
      @Deprecated("Deprecated in Java")
      override fun onError(utteranceId: String) { main.post { end(utteranceId.toIntOrNull(), false) } }
      override fun onStop(utteranceId: String, interrupted: Boolean) { main.post { end(utteranceId.toIntOrNull(), false) } }
    })
    waiting?.invoke()
  }

  /** Plays an audio file once. `finished(false)` when it can't be played or is stopped. */
  fun playClip(ctx: Context, uri: String, finished: (Boolean) -> Unit) {
    val id = begin(finished)
    val mp = MediaPlayer()
    try {
      mp.setAudioAttributes(attributes(AudioAttributes.CONTENT_TYPE_MUSIC))
      mp.setDataSource(ctx, Uri.parse(uri))
      mp.setOnCompletionListener { end(id, true) }
      mp.setOnErrorListener { _, what, _ -> AlarmStore.log(ctx, "read aloud: clip error $what"); end(id, false); true }
      mp.prepare()
      mp.start()
      player = mp
    } catch (e: Exception) {
      mp.release()
      AlarmStore.log(ctx, "read aloud: can't play $uri: ${e.javaClass.simpleName}")
      end(id, false)
    }
  }

  /** Stops what's being read, settling it. */
  fun stop() { end(reading, false) }

  /** Stops and frees the TTS engine, when the ring ends; the next reading starts a new one. */
  fun release() {
    stop()
    tts?.shutdown()
    tts = null
    ttsReady = false
  }

  private fun begin(finished: (Boolean) -> Unit): Int {
    stop()
    reading++
    settle = finished
    AlarmService.instance?.onReading(true)
    return reading
  }

  private fun end(id: Int?, played: Boolean) {
    if (id != reading) return
    val done = settle ?: return
    settle = null
    waitingForTts = null
    tts?.stop()
    player?.run {
      try { stop() } catch (_: Exception) {}
      release()
    }
    player = null
    AlarmService.instance?.onReading(false)
    done(played)
  }
}
