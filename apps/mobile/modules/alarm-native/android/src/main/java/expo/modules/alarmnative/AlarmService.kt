package expo.modules.alarmnative

import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.BroadcastReceiver
import android.content.IntentFilter
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
import android.os.SystemClock
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
    /** The start reason of a ring that just came due; any other start takes over an existing ring. */
    const val REASON_SCHEDULED = "scheduled ring"
    const val CHANNEL_ID = "alarm_ringing_v1"
    private const val NOTIFICATION_ID = 4242
    private const val WAY_BACK_ID = 4243
    /** The start reason when a snooze's alarm fires: the same ring ramps up again. */
    const val REASON_SNOOZE_ENDED = "snooze ended"
    /** The start reason for Answer now on a snoozed ring: the session begins silent. */
    const val ANSWER_NOW = "answer now"

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
      AlarmScheduler.cancelSnooze(ctx)
      AlarmActivityListener.applyLockFlags(false)
      AlarmStore.log(ctx, "dismissed with no service running")
    }
  }

  private val unlocked = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) { onUnlocked() }
  }
  private val handler = Handler(Looper.getMainLooper())
  private var player: MediaPlayer? = null
  private var tone: android.media.ToneGenerator? = null
  private var toneVolume = -1
  private var vibrator: Vibrator? = null
  private var focus: AudioFocusRequest? = null
  private var savedAlarmVolume = -1
  private var target = 1f
  private var rampSeconds = 0
  private var rampFrom = -1L // elapsedRealtime when the ramp began; -1 when not ramping

  var level = 0f
    private set
  /** The ring this instance is ringing, and the volume policy it runs for it. */
  private var ringId: String? = null
  private var policy: RingPolicy? = null
  private var rendered: RingPolicy.Sound? = null
  private var wayBackShown = false

  private fun log(msg: String) = AlarmStore.log(this, msg)

  private fun setting(key: String) = AlarmStore.setting(this, key)

  private val tick = object : Runnable {
    override fun run() {
      level = if (rampFrom >= 0) minOf(target, Ramp.level(SystemClock.elapsedRealtime() - rampFrom, rampSeconds)) else target
      applyVolume()
      handler.postDelayed(this, 250)
    }
  }

  private val watchdogRefresh = object : Runnable {
    override fun run() {
      AlarmScheduler.armWatchdog(this@AlarmService, 60_000)
      handler.postDelayed(this, 20_000)
    }
  }

  private val policyTimer = Runnable {
    val p = policy ?: return@Runnable
    for (fired in p.advance(SystemClock.elapsedRealtime())) when (fired) {
      RingPolicy.Fired.IDLE -> log("no answer for ${setting("idleSeconds")}s: full volume")
      RingPolicy.Fired.LEFT -> {
        log("alarm screen left for ${setting("leaveSeconds")}s: full volume, posting the way-back notification")
        if (setting("directLaunch") == 1) tryLaunch("leave")
      }
    }
    render()
  }

  override fun onCreate() {
    super.onCreate()
    instance = this
    ensureChannel(this)
    ContextCompat.registerReceiver(this, unlocked, IntentFilter(Intent.ACTION_USER_UNLOCKED),
      ContextCompat.RECEIVER_NOT_EXPORTED)
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
    val reason = intent?.getStringExtra("reason") ?: "sticky restart"
    val active = AlarmStore.ring(this)!!.getString("id")
    if (active == ringId) {
      // Already ringing it (e.g. the watchdog after a swipe-away): keep the session as it is.
      log("start ($reason) for the ring already playing")
      if (!AlarmActivityListener.visible && setting("directLaunch") == 1) tryLaunch(reason)
      return START_STICKY
    }
    val how = when (reason) {
      REASON_SCHEDULED, REASON_SNOOZE_ENDED -> RingPolicy.Start.FRESH
      ANSWER_NOW -> RingPolicy.Start.ANSWER_NOW
      else -> RingPolicy.Start.TAKEOVER
    }
    if (how == RingPolicy.Start.TAKEOVER) {
      // A new service taking over a ring: after a kill, a swipe-away that took the process, or a reboot.
      AlarmStore.event(this, "serviceRestarted")
      log("service took over ring $active ($reason)")
    }
    beginRinging(active, how, reason)
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

  private fun beginRinging(id: String, how: RingPolicy.Start, reason: String) {
    val pm = getSystemService(PowerManager::class.java)
    val km = getSystemService(KeyguardManager::class.java)
    val nm = getSystemService(NotificationManager::class.java)
    val fsi = if (Build.VERSION.SDK_INT >= 34) nm.canUseFullScreenIntent() else true
    log(
      "RING ($reason) start=$how screenOn=${pm.isInteractive} locked=${km.isKeyguardLocked} " +
        "fullScreenIntentAllowed=$fsi dndFilter=${nm.currentInterruptionFilter} " +
        "ringerMode=${getSystemService(AudioManager::class.java).ringerMode}",
    )
    AlarmActivityListener.applyLockFlags(true)
    // A restarted service rings at full: the user taps Start again, keeping the progress. Answer now
    // keeps the `session` phase native already set.
    if (how != RingPolicy.Start.ANSWER_NOW) AlarmStore.setPhase(this, null, "ringing")
    ringId = id
    rendered = null
    val now = SystemClock.elapsedRealtime()
    policy = RingPolicy(setting("leaveSeconds") * 1000L, setting("idleSeconds") * 1000L).apply {
      start(now, how)
      if (AlarmActivityListener.visible) screenShown(now)
    }
    render()
    if (player == null && tone == null) startSound()
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
    rampSeconds = setting("rampSeconds")
    rampFrom = if (ramp) SystemClock.elapsedRealtime() else -1L
    level = if (ramp) minOf(t, Ramp.level(0, rampSeconds)) else t
    applyVolume()
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
      toneVolume = (vol() * 100).toInt()
      tone = android.media.ToneGenerator(AudioManager.STREAM_ALARM, toneVolume)
      if (toneVolume > 0) tone!!.startTone(android.media.ToneGenerator.TONE_CDMA_ALERT_CALL_GUARD, -1)
      log("playing ToneGenerator fallback")
    } catch (e: Exception) {
      log("NO SOUND: every ringtone URI and the tone fallback failed: ${e.message}")
    }
  }

  private fun applyVolume() {
    player?.setVolume(vol(), vol())
    if (tone == null) return
    val volume = (vol() * 100).toInt()
    if (volume == toneVolume) return
    tone?.release()
    toneVolume = volume
    tone = android.media.ToneGenerator(AudioManager.STREAM_ALARM, volume)
    if (volume > 0) tone?.startTone(android.media.ToneGenerator.TONE_CDMA_ALERT_CALL_GUARD, -1)
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

  fun onUnlocked() {
    // Retarget the notification, keeping the ring, audio and volume policy intact.
    if (!AlarmStore.isRinging(this) || !getSystemService(android.os.UserManager::class.java).isUserUnlocked) return
    getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, ringingNotification())
    if (!AlarmActivityListener.visible) tryLaunch("user unlocked")
  }

  /** Makes the sound, vibration, way-back notification and timer match the policy. */
  private fun render() {
    val p = policy ?: return
    if (p.sound != rendered) {
      rendered = p.sound
      log("sound ${p.sound}")
      when (p.sound) {
        RingPolicy.Sound.RAMP -> { setTarget(1f, ramp = true); vibrate() }
        RingPolicy.Sound.FULL -> { setTarget(1f, ramp = false); vibrate() }
        RingPolicy.Sound.SILENT -> {
          setTarget(0f, ramp = false)
          vibrator?.cancel()
          vibrator = null
        }
      }
    }
    if (p.wayBack != wayBackShown) {
      wayBackShown = p.wayBack
      if (p.wayBack) postWayBack() else getSystemService(NotificationManager::class.java).cancel(WAY_BACK_ID)
    }
    handler.removeCallbacks(policyTimer)
    p.nextDeadline()?.let { handler.postDelayed(policyTimer, maxOf(0, it - SystemClock.elapsedRealtime())) }
  }

  private fun vibrate() {
    if (vibrator == null && setting("vibrate") == 1 && setting("silent") == 0) startVibration()
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

  private fun vol() = if (setting("silent") == 1) 0f else level

  private fun signal(change: RingPolicy.(Long) -> Unit) {
    val p = policy ?: return
    p.change(SystemClock.elapsedRealtime())
    render()
  }

  fun onScreenShown() = signal { screenShown(it) }

  fun onScreenLeft() = signal { screenLeft(it) }

  fun startSession() {
    log("session started: sound and vibration off")
    signal { sessionStarted(it) }
  }

  // An answer or tap: silence again if idle brought the sound back, and restart the idle timer.
  fun onActivity() = signal { activity(it) }

  fun dismiss() {
    AlarmStore.finish(this)
    AlarmScheduler.cancelSnooze(this)
    stopRinging()
  }

  // Snoozed: the ring stays stored with its snooze alarm armed; nothing sounds until it fires.
  fun snooze() {
    log("snoozed until ${AlarmStore.ring(this)?.optLong("snoozedUntil")}")
    stopRinging()
  }

  private fun stopRinging() {
    AlarmScheduler.cancelWatchdog(this)
    AlarmActivityListener.applyLockFlags(false)
    getSystemService(NotificationManager::class.java).cancel(WAY_BACK_ID)
    policy = null
    ringId = null
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
    unregisterReceiver(unlocked)
    super.onDestroy()
  }
}
