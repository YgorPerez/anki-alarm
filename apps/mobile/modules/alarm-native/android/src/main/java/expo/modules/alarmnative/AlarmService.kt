package expo.modules.alarmnative

import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

class AlarmService : Service() {
  companion object {
    const val ACTION_RING = "expo.modules.alarmnative.RING"
    private const val CHANNEL_ID = "alarm_ringing_v1"
    private const val NOTIFICATION_ID = 4242
    private const val WAY_BACK_ID = 4243

    @Volatile
    var instance: AlarmService? = null

    fun start(ctx: Context, reason: String) {
      val intent = Intent(ctx, AlarmService::class.java).setAction(ACTION_RING).putExtra("reason", reason)
      try {
        ContextCompat.startForegroundService(ctx, intent)
      } catch (e: Exception) {
        AlarmStore.log(ctx, "startForegroundService FAILED ($reason): ${e.javaClass.simpleName}: ${e.message}")
      }
    }

    fun ensureChannel(ctx: Context) {
      val nm = ctx.getSystemService(NotificationManager::class.java)
      if (nm.getNotificationChannel(CHANNEL_ID) != null) return
      val channel = NotificationChannel(CHANNEL_ID, "Ringing alarm", NotificationManager.IMPORTANCE_HIGH).apply {
        setSound(null, null) // the service plays the sound itself
        enableVibration(false)
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      }
      nm.createNotificationChannel(channel)
    }

    // Dismiss when the service is already gone (e.g. killed and the watchdog hasn't fired yet).
    fun dismissWithoutService(ctx: Context) {
      AlarmStore.finish(ctx)
      AlarmScheduler.cancelWatchdog(ctx)
      AlarmActivityListener.applyLockFlags(false)
      AlarmStore.log(ctx, "dismissed with no service running")
    }
  }

  private val handler = Handler(Looper.getMainLooper())
  private var player: MediaPlayer? = null
  private var tone: android.media.ToneGenerator? = null
  private var vibrator: Vibrator? = null
  private var focus: AudioFocusRequest? = null
  private var savedAlarmVolume = -1
  private var target = 1f
  private var rampPerTick = 1f

  var level = 0f
    private set
  var sessionStarted = false
    private set

  private fun log(msg: String) = AlarmStore.log(this, msg)

  private fun setting(key: String) = AlarmStore.setting(this, key)

  private val tick = object : Runnable {
    override fun run() {
      level = if (level < target) minOf(target, level + rampPerTick) else target
      player?.setVolume(vol(), vol())
      handler.postDelayed(this, 250)
    }
  }

  private val watchdogRefresh = object : Runnable {
    override fun run() {
      AlarmScheduler.armWatchdog(this@AlarmService, 60_000)
      handler.postDelayed(this, 20_000)
    }
  }

  private val leaveRunnable = Runnable {
    log("alarm screen left for ${setting("leaveSeconds")}s: full volume, posting the way-back notification")
    loud()
    postWayBack()
    if (setting("directLaunch") == 1) tryLaunch("leave")
  }

  private val idleRunnable = Runnable {
    log("no answer for ${setting("idleSeconds")}s: full volume")
    loud()
  }

  override fun onCreate() {
    super.onCreate()
    instance = this
    ensureChannel(this)
    log("service created")
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (!goForeground()) {
      stopSelf()
      return START_NOT_STICKY
    }
    if (!AlarmStore.isRinging(this)) {
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
      return START_NOT_STICKY
    }
    if (intent == null) {
      AlarmStore.event(this, "serviceRestarted")
      log("service restarted by the system with a null intent (START_STICKY)")
    }
    beginRinging(intent?.getStringExtra("reason") ?: "sticky restart")
    return START_STICKY
  }

  private fun ringingNotification(): Notification =
    NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setContentTitle(getString(R.string.alarm_title))
      .setContentText(getString(R.string.alarm_return))
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOngoing(true)
      .setContentIntent(AlarmScheduler.showIntent(this))
      .setFullScreenIntent(AlarmScheduler.showIntent(this), true)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .build()

  private fun goForeground(): Boolean {
    val n = ringingNotification()
    if (Build.VERSION.SDK_INT >= 34) {
      for ((name, type) in listOf(
        "systemExempted" to ServiceInfo.FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED,
        "mediaPlayback" to ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
      )) {
        try {
          startForeground(NOTIFICATION_ID, n, type)
          if (type != ServiceInfo.FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED) log("foreground as $name (fallback)")
          return true
        } catch (e: Exception) {
          log("startForeground($name) FAILED: ${e.javaClass.simpleName}: ${e.message}")
        }
      }
      return false
    }
    return try {
      startForeground(NOTIFICATION_ID, n)
      true
    } catch (e: Exception) {
      log("startForeground FAILED: ${e.javaClass.simpleName}: ${e.message}")
      false
    }
  }

  private fun beginRinging(reason: String) {
    val first = reason != "sticky restart"
    if (first) {

      sessionStarted = false
    }
    val pm = getSystemService(PowerManager::class.java)
    val km = getSystemService(KeyguardManager::class.java)
    val nm = getSystemService(NotificationManager::class.java)
    val fsi = if (Build.VERSION.SDK_INT >= 34) nm.canUseFullScreenIntent() else true
    log(
      "RING ($reason) first=$first screenOn=${pm.isInteractive} locked=${km.isKeyguardLocked} " +
        "fullScreenIntentAllowed=$fsi dndFilter=${nm.currentInterruptionFilter} " +
        "ringerMode=${getSystemService(AudioManager::class.java).ringerMode}",
    )
    AlarmActivityListener.applyLockFlags(true)
    if (player == null) startSound()
    if (vibrator == null && setting("vibrate") == 1 && setting("silent") == 0) startVibration()
    if (!sessionStarted) setTarget(1f, ramp = first)
    handler.removeCallbacks(tick)
    handler.post(tick)
    handler.removeCallbacks(watchdogRefresh)
    handler.post(watchdogRefresh)
    if (AlarmActivityListener.visible) {
      log("alarm screen already visible")
    } else if (setting("directLaunch") == 1) {
      tryLaunch("ring")
    }
  }

  private fun setTarget(t: Float, ramp: Boolean) {
    target = t
    val seconds = maxOf(1, setting("rampSeconds"))
    rampPerTick = 1f / (seconds * 4)
    if (!ramp || t < level) level = t
    if (ramp && level == 0f) level = 0.05f
    player?.setVolume(vol(), vol())
  }

  private fun startSound() {
    val audio = getSystemService(AudioManager::class.java)
    if (setting("silent") == 1) log("silent mode: playing at volume 0")
    if (setting("forceMaxVolume") == 1 && setting("silent") == 0) {
      savedAlarmVolume = audio.getStreamVolume(AudioManager.STREAM_ALARM)
      try {
        audio.setStreamVolume(AudioManager.STREAM_ALARM, audio.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0)
      } catch (e: Exception) {
        log("can't raise alarm stream volume: ${e.message}")
      }
    }
    log("alarm stream volume ${audio.getStreamVolume(AudioManager.STREAM_ALARM)}/${audio.getStreamMaxVolume(AudioManager.STREAM_ALARM)}")

    val attrs = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_ALARM)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()
    focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT).setAudioAttributes(attrs).build()
    log("audio focus: ${audio.requestAudioFocus(focus!!)}")

    val uris = listOfNotNull(
      AlarmStore.sound(this),
      RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_ALARM),
      Settings.System.DEFAULT_ALARM_ALERT_URI,
      RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
      RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
    )
    for (uri in uris) {
      val mp = MediaPlayer()
      try {
        mp.setAudioAttributes(attrs)
        mp.setDataSource(this, uri)
        mp.isLooping = true
        mp.setWakeMode(this, PowerManager.PARTIAL_WAKE_LOCK)
        mp.setVolume(vol(), vol())
        mp.prepare()
        mp.start()
        player = mp
        log("playing $uri")
        return
      } catch (e: Exception) {
        mp.release()
        log("can't play $uri: ${e.javaClass.simpleName}: ${e.message}")
      }
    }
    // Last resort, e.g. before the first unlock if the media provider can't serve ringtones.
    try {
      tone = android.media.ToneGenerator(AudioManager.STREAM_ALARM, if (setting("silent") == 1) 0 else 100)
      tone!!.startTone(android.media.ToneGenerator.TONE_CDMA_ALERT_CALL_GUARD, -1)
      log("playing ToneGenerator fallback")
    } catch (e: Exception) {
      log("NO SOUND: every ringtone URI and the tone fallback failed: ${e.message}")
    }
  }

  private fun startVibration() {
    val v =
      if (Build.VERSION.SDK_INT >= 31) {
        getSystemService(VibratorManager::class.java).defaultVibrator
      } else {
        @Suppress("DEPRECATION")
        getSystemService(Vibrator::class.java)
      }
    val effect = VibrationEffect.createWaveform(longArrayOf(0, 800, 600), 0)
    if (Build.VERSION.SDK_INT >= 33) {
      v.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM))
    } else {
      @Suppress("DEPRECATION")
      v.vibrate(effect, AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build())
    }
    vibrator = v
  }

  private fun tryLaunch(why: String) {
    try {
      startActivity(AlarmScheduler.launchIntent(this))
      log("startActivity from service ($why), overlayPermission=${Settings.canDrawOverlays(this)}")
    } catch (e: Exception) {
      log("startActivity from service ($why) FAILED: ${e.message}")
    }
    handler.postDelayed({ log("1.5s after launch ($why): alarm screen visible=${AlarmActivityListener.visible}") }, 1500)
  }

  private fun postWayBack() {
    val n = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setContentTitle(getString(R.string.alarm_title))
      .setContentText(getString(R.string.alarm_return))
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setContentIntent(AlarmScheduler.showIntent(this))
      .setFullScreenIntent(AlarmScheduler.showIntent(this), true)
      .build()
    getSystemService(NotificationManager::class.java).notify(WAY_BACK_ID, n)
  }

  private fun restartIdle() {
    handler.removeCallbacks(idleRunnable)
    handler.postDelayed(idleRunnable, setting("idleSeconds") * 1000L)
  }

  // Start silences the ring and vibration; leaving or going idle restores both.
  private fun quiet() {
    setTarget(low(), ramp = false)
    vibrator?.cancel()
    vibrator = null
  }

  // Left the screen or went idle: full sound and vibration again.
  private fun loud() {
    setTarget(1f, ramp = false)
    if (vibrator == null && setting("vibrate") == 1 && setting("silent") == 0) startVibration()
  }

  private fun vol() = if (setting("silent") == 1) 0f else level

  private fun low() = setting("lowLevel") / 100f

  fun onScreenShown() {
    handler.removeCallbacks(leaveRunnable)
    getSystemService(NotificationManager::class.java).cancel(WAY_BACK_ID)
    if (sessionStarted) {
      quiet()
      restartIdle()
    }
  }

  fun onScreenLeft() {
    handler.removeCallbacks(leaveRunnable)
    handler.postDelayed(leaveRunnable, setting("leaveSeconds") * 1000L)
  }

  fun startSession() {
    sessionStarted = true
    log("session started: sound at ${setting("lowLevel")}%, vibration off")
    quiet()
    restartIdle()
  }

  fun dismiss() {
    AlarmStore.finish(this)
    AlarmScheduler.cancelWatchdog(this)
    AlarmActivityListener.applyLockFlags(false)
    getSystemService(NotificationManager::class.java).cancel(WAY_BACK_ID)
    stopEverything()
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun stopEverything() {
    handler.removeCallbacksAndMessages(null)
    player?.run {
      try { stop() } catch (_: Exception) {}
      release()
    }
    player = null
    tone?.release()
    tone = null
    vibrator?.cancel()
    vibrator = null
    val audio = getSystemService(AudioManager::class.java)
    focus?.let { audio.abandonAudioFocusRequest(it) }
    focus = null
    if (savedAlarmVolume >= 0) {
      try { audio.setStreamVolume(AudioManager.STREAM_ALARM, savedAlarmVolume, 0) } catch (_: Exception) {}
      savedAlarmVolume = -1
    }
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    val ringing = AlarmStore.isRinging(this)
    log("task removed (swiped from recents), ringing=$ringing")
    if (ringing) AlarmScheduler.armWatchdog(this, 2_000)
    super.onTaskRemoved(rootIntent)
  }

  override fun onDestroy() {
    log("service destroyed, ringing=${AlarmStore.isRinging(this)}")
    stopEverything()
    instance = null
    super.onDestroy()
  }
}
