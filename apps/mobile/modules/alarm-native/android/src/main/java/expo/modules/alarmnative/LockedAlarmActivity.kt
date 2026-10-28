package expo.modules.alarmnative

import android.app.Activity
import android.os.Bundle
import android.widget.LinearLayout
import android.widget.TextView
import java.time.LocalTime
import java.time.format.DateTimeFormatter

class LockedAlarmActivity : Activity() {
  override fun onCreate(state: Bundle?) {
    super.onCreate(state)
    setShowWhenLocked(true); setTurnScreenOn(true)
    val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = android.view.Gravity.CENTER; setBackgroundColor(android.graphics.Color.BLACK) }
    for ((text, size) in listOf(LocalTime.now().format(DateTimeFormatter.ofPattern("HH:mm")) to 68f,
      (AlarmStore.ring(this)?.getJSONObject("alarm")?.optString("label") ?: "") to 28f, getString(R.string.alarm_unlock) to 23f)) {
      layout.addView(TextView(this).apply { this.text = text; textSize = size; setTextColor(android.graphics.Color.WHITE) })
    }
    setContentView(layout)
  }
}
