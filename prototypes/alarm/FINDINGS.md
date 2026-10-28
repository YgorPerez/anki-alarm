# Findings: a native alarm that can't be escaped (#6)

Emulator runs on 2026-10-28, on two Pixel 6 AVDs (`google_apis`, x86_64): Android 12 (API 31) and
Android 17 (API 37). The APK targets SDK 36. Every result comes from the prototype's log (logcat tag
`AlarmPrototype`) plus `dumpsys` (window, audio, alarm, notification, vibrator). The scripts are in
`test/`: `ui.py` taps the test screen over adb, and `scenario.sh` runs each case.

Not covered by an emulator, and still to check on real phones: OEM battery and background killers
(Xiaomi, Samsung, Motorola…), real vibration and loudness, and hours-long deep Doze. The emulator
refused `deviceidle force-idle` and stopped at INACTIVE.

## Results

| # | Check | Android 12 | Android 17 |
|---|---|---|---|
| 1 | Permissions on a fresh sideloaded install | Exact alarm, full-screen intent and notifications granted at install | Exact alarm (`USE_EXACT_ALARM`) and full-screen intent granted at install; notifications need the runtime prompt |
| 2 | Rings in silent and DND | Yes: `USAGE_ALARM` `MediaPlayer` at 7/7 with ringer silent and DND priority; volume ramps to 100%, drops to 15% when the session starts | Same |
| 2 | Vibration with the screen off | Requested with `USAGE_ALARM` (`dumpsys vibrator_manager`); the emulator has no motor (scale 0) | Same |
| 3 | Locked, screen off, app in background | Full-screen intent alone wakes the screen and opens the alarm over the keyguard | Same |
| 3b | Phone unlocked and in use (another app in front) | Full-screen intent only shows a heads-up; the sound rings. Direct `startActivity` from the service got through even without the overlay permission | Heads-up only. Direct `startActivity` is blocked (`Background activity launch blocked`) unless "Display over other apps" is granted, which lets it through |
| 4 | Leaving the alarm screen (Home) | After 10 s: full volume and the way-back notification; reopening on its own follows 3b | Same |
| 5 | Swipe from Recents | Process survives (foreground service); `onTaskRemoved` logged; the watchdog re-rings | Same; with overlay the screen comes back |
| 5 | Force-stop | Ringing stops and every scheduled alarm is dropped (Android's stopped state); nothing comes back until the app is opened | Same |
| 6 | Reboot, alarm scheduled, phone has a PIN | **Before the fix: alarms gone and not re-armed until the first unlock, so the alarm never rang.** After the fix: re-armed on `LOCKED_BOOT_COMPLETED` | After the fix: same |
| 6 | Reboot mid-ring, PIN | After the fix: rings again while still locked; the alarm screen opens after unlock only if 3b allows it | Same; opened after unlock (overlay granted) |
| 7 | Time zone change, clock change, app update | `MY_PACKAGE_REPLACED` re-arms | `TIMEZONE_CHANGED`, `TIME_SET` and `MY_PACKAGE_REPLACED` re-arm; `setAlarmClock` keeps the wall-clock time |

## Fixes made while testing

1. **Direct Boot.** `BootReceiver`, `AlarmReceiver` and `AlarmService` are `directBootAware`;
   `BootReceiver` also takes `LOCKED_BOOT_COMPLETED`; `AlarmStore` uses device-protected storage
   (`createDeviceProtectedStorageContext`). Without this, a phone that reboots at night with a PIN
   doesn't ring in the morning.
2. **Sound before the first unlock.** The media ringtone URI fails (`setDataSource failed`), but
   `content://settings/system/alarm_alert` plays. A `ToneGenerator` on the alarm stream is the last
   fallback.
3. **Opening the app after a force-stop** showed the ringing screen with no service and no sound on
   Android 12. Now opening the app restarts the ring service when the session is still ringing.
4. **After the first unlock** the ring service tries to open the alarm screen again
   (`BOOT_COMPLETED` while ringing).

## Gotchas for the real module

- **"Display over other apps" is the only way to take over an unlocked phone in use** on Android 17
  (and the reliable way on 12). Without it the alarm is a heads-up plus sound until tapped, and after
  leaving the screen it comes back only as a notification. Ask for it during onboarding, explained,
  alongside notifications.
- **The alarm activity isn't Direct Boot aware**, so before the first unlock the user hears the alarm
  and sees only the notification. Making the React Native activity Direct Boot aware is a bigger
  question (JS bundle, SQLite and the deck's media live in credential storage). The alternative is
  a small native lock-screen activity for that case.
- **Alarms missed during a reboot** (due while the phone was off) are dropped by the prototype. The
  real app needs a rule: ring if missed by less than a few minutes.
- **Force-stop is unrecoverable** by design. Settings can warn about it, but nothing can re-arm.
- **Measure ring durations with a monotonic clock.** The prototype used the wall clock and reported
  "dismissed after -39891514 s" after a clock change. Wake-up stats need `elapsedRealtime`.
- **Time zones:** the prototype stores absolute instants, so after a zone change the alarm rings at
  the same instant, not the same local time. Core's alarm time math must recompute the next ring
  from the alarm's local time on `TIMEZONE_CHANGED`.

## Module API, as the spike shaped it

`schedule(seconds) → id`, `cancel(id)`, `ringNow()`, `startSession()`, `answer(good) → correct`,
`dismiss()`, `getState()` (ringing, correct, service alive, screen visible, level, alarms, next
system alarm, permissions, settings, audio, device), `getLog()`, `setSetting(key, value)`,
`requestNotifications()`, `openSettings(target)`. It's the starting point for #30. The real API
schedules by alarm (local time, repeat days) rather than by seconds, and Core decides session
progress, not the module.
