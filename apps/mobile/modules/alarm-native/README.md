# Android alarms

This local Expo module adapts the `prototype/alarm` foreground service for #40. Expo autolinks it
from `apps/mobile/modules`; generated Android projects and Gradle output stay untracked.

`AlarmService` in `src/alarms.ts` is the Effect boundary. `alarm-android.ts` serializes the native
API; the in-memory layer drives controller tests. The controller saves before replacing the full
enabled schedule and ingests journal events transactionally before acknowledging their IDs.
Replays are safe because SQLite uses the native event ID as its primary key.

The #40 API covers `setAlarms`, `list`, `getRing`, `dismiss`, `drainJournal`, `ack`, permission
checks/requests and a change notification. Native state and journal live in device-protected
SharedPreferences. Ring creation and dismissal commit state and their event in one write. Alarm
IDs and ring/event IDs are UUIDv7.

#41 adds the session signals. `sessionStarted(ringId)` sets the stored ring's phase to `session`
and silences sound and vibration; `activity(ringId)` restarts the idle timer and silences again
after an idle return. Both ignore a ring id that isn't the active ring. A restarted service sets
the phase back to `ringing` and rings at full; the user taps Start again and the session keeps its
progress, which JS reads from reviews carrying the ring id. Native does not count answers. The
session uses the larger N of absorbed alarms and keeps the active ring's deck.

#46 adds snooze. `snooze(ringId, minutes)` stores phase `snoozed`, counts the ring's `snoozes`,
sets `snoozedUntil`, journals `snoozed` and stops the service; it returns the ring's JSON. The
re-ring is a `setAlarmClock` exact alarm (`SNOOZE_END`), re-armed by `rearmAll` after a reboot or
force-stop, or rung at once if its time has passed. It journals `snoozeEnded` and starts the
service, which rings the same ring id. `sessionStarted` on a snoozed ring is Answer now: it
cancels the snooze alarm and starts the service straight into a silent session. An alarm due
while snoozed is absorbed, as during any ring. JS checks the cap and adds the snooze cost to N.

`otherNextAlarm()` (polled while the Alarm tab shows) reads another app's next alarm from `AlarmManager.getNextAlarmClock()`, with that app's name and icon when
package visibility allows, and `openOtherAlarm()` sends the intent that app registered with it. Both are read-only towards that app.

#47 adds the awake check. `dismiss(ringId, awakeCheckAfter)` takes seconds (Core's
`awakeCheckAfter(alarm)`) or null. With seconds, the dismissal and the pending check
(`{ id, ringId, alarm, dueAt }`) commit in one write, and `AwakeCheck.advance` arms an exact alarm
for `dueAt`. When it fires, native journals `awakeCheckShown` (with the dismissed ring's id), sets
`shownAt`, posts a silent full-screen notification (plus `startActivity` with overlay access) and
arms a second exact alarm `awakeCheckSeconds` later. `awakeCheckPassed(checkId)` journals
`awakeCheckPassed` and clears it. If the timeout fires first, native journals `awakeCheckFailed` and
fires the alarm again as a new ring. Before the first unlock the card can't show, so a check that
comes due then fails at once and rings. A check that comes due during another ring (snoozed or not) is dropped.
`rearmAll` re-arms or runs a pending check after a reboot or `setAlarms`. `getAwakeCheck()` returns
the pending check. JS shows the prompt only once `shownAt` is set.

The service runs one `RingPolicy` per ring; its `Start` says how the ring began: `FRESH` (due, or a
snooze ended: ramps), `TAKEOVER` (a new service after a kill or reboot: full, journals
`serviceRestarted`) or `ANSWER_NOW` (silent session).

#48 adds read aloud. `speak(text, language)` and `playClip(uri)` play on the alarm stream
(`ReadAloud.kt`), so they're heard in silent and Do Not Disturb. Each resolves when its reading ends,
is replaced by the next or is stopped (`stopReading`); `playClip` resolves false when the file can't
play, and JS then speaks the front instead. While one reads, the ring stays silent and the idle
timer waits; it restarts when the reading ends (RingPolicy `readingStarted`/`readingEnded`). Leaving the screen long enough to bring the ring
back stops the reading. A missing TTS voice for the deck's language uses the engine's default.

#78 adds skip next. An alarm's `skip` is the epoch-ms time of one occurrence that won't ring (null or
absent for none). `NextRing.of(alarm, now, zone)` passes over it, as Core's `upcomingRing` does, so
`setAlarms` arms the following occurrence, and the next occurrence again once JS sends the alarm
with `skip` null. A skip that has passed, or that the rule no longer rings at, has no effect.

## Verification

From the repository root:

```sh
pnpm check
pnpm test
pnpm --filter @app/mobile exec expo prebuild --platform android --no-install
cd apps/mobile/android
./gradlew :alarm-native:testDebugUnitTest :app:assembleDebug
```

The JVM test and Core use `packages/core/fixtures/next-ring.json`. Weekdays are ISO (Monday 1,
Sunday 7). A spring gap moves the time forward by the gap; an autumn overlap uses its earlier
instant, matching `java.time`. A passed first occurrence in an overlap does not schedule the second.

The APK still needs the locked/unlocked, silent/DND, reboot with PIN, time/zone changes, update,
kill/restart and OEM scenarios documented in `docs/research/oem-background-limits.md`. Denying
notifications, exact alarms, full-screen intent or overlay can prevent delivery or screen takeover;
the alarm list exposes links to missing permissions. Force-stop removes alarms until app launch.

## Reliability setup (#44)

`getPermissions()` now returns Core's `AlarmPermissions`, with `granted`, `denied` or `unknown`
values rather than booleans. It includes the manufacturer, SDK, install source and standby bucket.
`backgroundRestricted: granted` means Android allows background activity. MIUI lock-screen and
background-window app-ops are best-effort reads; inaccessible APIs return `unknown`. Autostart,
PowerKeeper, Samsung sleep lists and Recents locking require manual checks.

`request(kind)` returns whether a runtime prompt or settings page was opened. OEM activities may
change; failed launches fall back to App info. Notification requests use the runtime prompt once,
then notification settings for denied access or a disabled channel. Overlay setup re-reads the
permission before opening Settings. Downloaded/local installs on Android 15+ get restricted-settings
instructions only while overlay access is missing.

`isOnboardingComplete()` and `completeOnboarding()` use local SharedPreferences, independently of
alarm storage and sync. Finishing does not claim all permissions were granted. Manual confirmations
last only for the current checklist visit; reopening Settings starts a fresh check. App resume
re-reads permissions, and an active ring takes priority over onboarding and Settings.

## Direct Boot (#43)

`setAppearance({ background, foreground, primary }, locale)` on the Effect service mirrors hex
colors and `pt-BR`/`en` into device-protected storage. Home sends the chosen dark background,
foreground and primary ink whenever the theme or locale changes. The native activity bundles Inter bold for its live clock (tabular figures, unslashed zero),
Atkinson Hyperlegible for other text, and Android strings. It offers no silence or snooze action.
The Inter font resource requires an APK rebuild; OTA updates cannot add Android resources.
`INTER-FONT-LICENSE` carries Inter's SIL Open Font License. Its `inter_bold.ttf` is the same file as
`@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf`, loaded by the React Native app.

Custom sounds are copied atomically before scheduling. If the provider permission expires, keep
the last complete copy; without a copy the service tries the system alarm URI and ToneGenerator.
No network or credential-protected file is needed to ring.

To verify on a PIN-protected emulator (in addition to the JVM regression tests):

1. Install the built APK, open the app and grant notification/full-screen/overlay permissions.
2. Set a PIN in Android Settings. Save an enabled alarm for three minutes ahead. For a custom
   sound, choose a bundled sound, system ringtone or audio file in the alarm editor.
3. Run `adb reboot`, leave the PIN locked, and inspect `adb logcat -s AlarmNative` and
   `adb shell dumpsys alarm`. Confirm re-arming at locked boot, sound playback from the saved file,
   and the native clock, label and unlock instruction. Leaving that activity must not silence it.
4. Unlock with the PIN. Confirm the RN alarm screen opens and still has the same native `getRing()`
   ID. Unlocking must not append another `ringStarted` or `dismissed` event.
5. Reboot mid-ring. Confirm the ring resumes before unlock with the same ID.
6. Schedule once alarms, power off across their due time, then boot at 30 minutes late and again
   over 30 minutes late. The first rings; the latter appends one `missed` event without ringing.
   Unlocking and subsequent boot broadcasts must not repeat either occurrence.

Hardware is still needed to check audible output, vibration and OEM restrictions.

## Sound and vibration (#45)

Core stores a tagged sound choice (`default`, `bundled`, `ringtone`, `file`). Old null sounds
normalize to `default`. The native module owns the Android picker, audio playback, previews,
vibration and volume ramp. Bundled WAVs are generated tones with no external recordings.

The editor offers Dawn, Chimes and Classic, the Android alarm ringtone picker and an audio document
picker. File choices retain a persistable read grant when supported. Cancel leaves the choice alone.
Previews stop after eight seconds, when the app leaves the foreground or when the editor unmounts.
Saving an alarm freezes its selected sound in device-protected files before scheduling. An unchanged
choice reuses its copy, including after its original file disappears. A different unreadable choice
falls back rather than playing the previous choice. App updates refresh saved copies when possible.

The service tries the frozen copy, the system alarm sound and other system tones, then generates a
tone if none can be opened. Both MediaPlayer and the generated tone follow silence/full-volume
session signals. The ramp runs natively in decibels; zero seconds means full volume immediately.

Device checks: save and ring each source type, cancel both pickers, change vibration and ramp,
delete the original file, reboot with a PIN without unlocking, and remove the saved copy to check
fallback. A device with inaccessible system tones is needed to verify the final generated tone.
Confirm Start silences both audio paths and vibration, and leaving/idle restores them at full.

## A ring you can't escape (#42)

`RingPolicy.kt` holds the volume rules without Android, as deadlines on `elapsedRealtime`: a new
ring ramps; Start silences sound and vibration; leaving the RN screen for `leaveSeconds` brings both
back at full with the way-back notification and a relaunch; `idleSeconds` with no answer brings them
back at full; any answer or return to the screen quiets them again. `AlarmService` feeds it the
screen's visibility and JS's signals and renders its state.

A service instance remembers the ring it plays. A second start for that ring (the watchdog after a
swipe-away, opening the app) keeps the session as it is. A new instance taking over a stored ring
(START_STICKY after a kill, the watchdog after the process died, a reboot) journals
`serviceRestarted`, sets the phase back to `ringing` and rings at full without the ramp; Start then
resumes the count from the ring's reviews. Only a ring that just came due (`REASON_SCHEDULED`) ramps.

An alarm due during a ring is journaled as `absorbed` with the ring's id and re-arms for its next
occurrence. Core's `ringNeed(ring, journal, alarms)` takes the larger N; the deck stays the ring's.

JVM tests: `RingPolicyTest` (the rules) and `InescapableRingTest` (the real service under
Robolectric: leave, idle, watchdog, restart after a kill, reboot mid-session, folding).
`test/scenario.sh` runs the #6 adb scenarios against the app on an emulator; see its header.

Emulator run, 2026-10-28, `alarm-api37` (Android 17, x86_64, PIN 1234, overlay granted), x86_64
release APK. Every case passed:

- Ring with the app in the background: ramp, `startActivity` brought the screen to the front.
- `leave`: Home after Start; 10 s later full volume, way-back notification and relaunch; back on the
  screen it went quiet.
- `idle`: 20 s with no answer, full volume. `answer`: Again after idle, quiet again.
- Fold: a second alarm (N 5) came due during the ring (N 3). No new ring; the screen went to
  "0 de 5" on the same deck.
- `swipe-away`: `onTaskRemoved`, the process stayed up, the leave timer brought the screen back.
  While the card sits in Overview the activity is still started, so leave doesn't count; idle does.
- `crash`: `am crash`, START_STICKY restart, "service took over ring", full volume, screen back,
  Start shown again.
- `reboot` after one right answer: rang at `LOCKED_BOOT_COMPLETED` before unlock with the native
  lock-screen activity and the same ring id; after the PIN, Start resumed at "1 de 5".
- Answering the rest dismissed the ring and stopped the service.

The emulator has no vibration motor and its audio can't be heard, so loudness and vibration still
need a real phone; the log's `sound RAMP/FULL/SILENT` lines show what native applied.
