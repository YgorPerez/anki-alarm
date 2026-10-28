# The alarm-native module: native rings, Core decides

Alarms ring through a local Kotlin Expo module, `modules/alarm-native`, behind an Effect
`AlarmService` in `apps/mobile`. Native owns everything that has to work with no JS running: the
next-ring math, re-arming, the sound and its volume, timers, and the ring's phase. JS and Core own
everything that needs the decks: the session, its progress and when it ends. We split it this way
because the #6 prototype showed the alarm must ring after a reboot with a PIN, before the first
unlock, when the JS bundle, SQLite and media are all locked away in credential storage. Decided in
#30.

## Layers

- `AlarmService` (Effect) is the platform-neutral contract the app codes against. It has capability
  flags, `canHoldDismissal` and `canTakeOverScreen`, because iOS's AlarmKit can do neither: there the
  alarm rings, opens the session, and the awake check does the holding.
- Under it sits one thin native module per platform, shaped to its OS: Kotlin now, AlarmKit later.
- AnkiDroid's ContentProvider code is a separate module, `modules/ankidroid`. It has nothing to do
  with ringing and has its own permission.

## The Android module

### Scheduling

- `setAlarms(alarms, ringPolicy)` is declarative: JS sends every enabled alarm whenever any alarm
  changes, after a sync pull, and on each app start. Native diffs, stores and re-arms. Calling it on
  app start also repairs a force-stop, which drops every alarm and can't be prevented. `list()`
  returns what native holds, for diagnostics.
- Each alarm carries its rule (local time, repeat days or a once-date), label, sound, vibration and
  ramp. Native copies the sound into device-protected storage so it plays before the first unlock;
  the fallbacks stay `content://settings/system/alarm_alert`, then a `ToneGenerator`.
- Native computes the next ring from the rule with `java.time`, as `setAlarmClock` exact alarms. It
  re-arms on `LOCKED_BOOT_COMPLETED`, `BOOT_COMPLETED`, `TIME_SET`, `TIMEZONE_CHANGED`,
  `MY_PACKAGE_REPLACED` and after each ring. Core has the same math for display ("rings in 7 h");
  both run the same JSON fixtures from `packages/core`.
- `ringPolicy` holds the fixed timings, defined as constants in Core: re-ring after leaving the
  screen (10 s), idle time before full volume, the awake check's 60 s. They aren't user settings,
  and an OTA can tune them.

### A ring

A **ring** is one firing of an alarm, from its first sound to dismissal, through snoozes. Native
gives each ring a UUIDv7 id.

- At ring time a foreground service plays the sound on the alarm stream, vibrates, ramps the volume
  and opens the alarm screen by full-screen intent (plus `startActivity` when "Display over other
  apps" is granted). It rings until dismissal; there is no give-up timeout.
- JS signals `sessionStarted(ringId)` (sound and vibration stop), `activity(ringId)` (any tap or
  answer, resets the idle timer), `snooze(ringId, minutes)` and `dismiss(ringId, { awakeCheckAfter })`.
  `dismiss` is idempotent. Native runs the volume policy itself from these signals and from whether
  the alarm screen is visible, so a stalled JS thread can't leave the alarm quiet.
- Native owns the snooze and awake-check timers as exact alarms, so they survive kills and reboots.
  The awake check's prompt is the RN screen with one card; with no answer before the timeout, native
  starts a new ring.
- Before the first unlock the RN screen can't open, so a small native lock-screen activity shows
  the clock, the alarm's label and "Unlock to start". It can't silence or snooze. `setAppearance(colors,
  locale)` mirrors the derived alarm-screen colors and the locale into device-protected storage for
  it; its copy is Android string resources, pt-BR by default plus English.
- `speak(text, lang)` and `playClip(uri)` play read aloud (TTS or the card's own audio) on the alarm
  stream, so they're heard in silent and Do Not Disturb, with the alarm sound ducked under them.

### Rules native applies alone

- **Missed:** an alarm that came due while the phone was off rings at boot if it's 30 minutes late
  or less; otherwise it's journaled as missed.
- **Overlap:** an alarm that comes due during a ring is folded into it and journaled as absorbed.
  The session keeps the current ring's deck and needs the larger N. The absorbed alarm re-arms for
  its next occurrence.

### State and events

- Native stores only the ring's phase (alarm, ring id, ringing / in session / snoozed / awake
  check, start times) in device-protected storage. The session's progress is reviews in SQLite with
  origin alarm session and the ring id; Core counts them and decides dismissal. Native never counts
  answers.
- Every native event goes to a durable journal in device-protected storage, with wall time and
  `elapsedRealtime`, and is also emitted live: ring started, screen left and returned, service
  restarted after a kill, snoozed, snooze ended, awake check shown, passed and failed, absorbed,
  missed, dismissed. JS drains it into SQLite with an ack on start and resume. Wake-up stats come
  from it, with durations from the monotonic clock.

### Permissions

`getPermissions()` reports notifications, exact alarm, full-screen intent, display over other apps
and battery optimization. `request(kind)` shows the runtime prompt or opens the right settings
page; JS re-checks on resume. Onboarding asks for notifications and display over other apps (the
only way to take over an unlocked phone in use on Android 17); Settings shows the rest and warns
that force-stop drops alarms.

Amended in #35: Start silences the ring and stops the vibration instead of dropping to a low level.
Decided after the first real-phone round. Leaving the screen or going idle brings both back at
full.

## Testing

An in-memory `AlarmService` layer drives the JS tests of the alarm screen and the journal ingest.
The next-ring fixtures run in Core's tests and in a Kotlin JVM unit test, so the two
implementations can't drift. Device behavior stays with the adb scenarios from #6 and the OEM checks
in #35.

## Considered options

- **One native API shared by Android and iOS.** AlarmKit's model (system UI, no service, no volume
  control) doesn't fit Android's, so one side would fake it.
- **JS precomputes ring instants.** One implementation of the time math, but a zone change before
  unlock or with JS dead rings at the wrong local time.
- **Native counts the session.** Survives anything, but copies Core's dismiss rules into Kotlin.
- **Imperative schedule/cancel.** JS would have to track what native holds and repair drift after a
  force-stop.
- **Notification only before unlock.** Less to build, but the first screen after a night reboot
  wouldn't look like the alarm.
