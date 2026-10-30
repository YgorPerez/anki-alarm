package expo.modules.alarmnative

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Intent
import android.content.IntentFilter
import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextClock
import android.widget.TextView
import org.json.JSONObject
import java.util.Locale

// No React Native, credential storage, or controls that could silence the ring.
class LockedAlarmActivity : Activity() {
  private val unlocked = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) { handOff() }
  }
  private var listening = false
  private fun handOff() {
    if (!getSystemService(android.os.UserManager::class.java).isUserUnlocked) return
    if (AlarmStore.isRinging(this)) startActivity(AlarmScheduler.launchIntent(this))
    finish()
  }
  override fun onResume() { super.onResume(); handOff() }
  override fun onDestroy() {
    if (listening) unregisterReceiver(unlocked)
    super.onDestroy()
  }
  override fun attachBaseContext(base: Context) {
    val locale = AlarmStore.prefs(base).getString("locale", "pt-BR")!!
    val config = Configuration(base.resources.configuration)
    config.setLocale(Locale.forLanguageTag(locale))
    super.attachBaseContext(base.createConfigurationContext(config))
  }

  override fun onCreate(state: Bundle?) {
    super.onCreate(state)
    if (AlarmStore.ring(this) == null) { finish(); return }
    if (Build.VERSION.SDK_INT >= 27) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
    }
    val colors = JSONObject(AlarmStore.prefs(this).getString("colors", "{}")!!)
    val foreground = Color.parseColor(colors.optString("foreground", "#ffffff"))
    val primary = Color.parseColor(colors.optString("primary", "#c9b6ff"))
    val layout = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      val padding = (24 * resources.displayMetrics.density).toInt()
      setPadding(padding, padding, padding, padding)
      setBackgroundColor(Color.parseColor(colors.optString("background", "#000000")))
    }
    layout.addView(TextClock(this).apply {
      format12Hour = "HH:mm"; format24Hour = "HH:mm"
      fontFeatureSettings = "tnum"
      textSize = 68f; setTextColor(foreground); gravity = Gravity.CENTER
      typeface = androidx.core.content.res.ResourcesCompat.getFont(this@LockedAlarmActivity, R.font.inter_bold)
    })
    for ((text, size, color) in listOf(
      Triple(AlarmStore.ring(this)!!.getJSONObject("alarm").optString("label"), 28f, foreground),
      Triple(getString(R.string.alarm_unlock), 23f, primary),
    )) {
      layout.addView(TextView(this).apply {
        this.text = text; textSize = size; setTextColor(color); gravity = Gravity.CENTER
        typeface = androidx.core.content.res.ResourcesCompat.getFont(this@LockedAlarmActivity, R.font.atkinson_regular)
        setPadding(0, (16 * resources.displayMetrics.density).toInt(), 0, 0)
      })
    }
    setContentView(layout)
    androidx.core.content.ContextCompat.registerReceiver(this, unlocked,
      IntentFilter(Intent.ACTION_USER_UNLOCKED), androidx.core.content.ContextCompat.RECEIVER_NOT_EXPORTED)
    listening = true
    handOff() // Covers unlock racing with receiver registration.
  }
}
