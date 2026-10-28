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
IDs and ring/event IDs are UUIDv7. The temporary dismiss button is the replacement point for #41.

Later alarm tickets add session signals, snooze, awake checks, read aloud and theme mirroring from
ADR 0005. Native does not count answers. The overlap event identifies the absorbed alarm; #41 must
use its N without replacing the active ring's deck.

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

## Direct Boot (#43)

`setAppearance({ background, foreground, primary }, locale)` on the Effect service mirrors hex
colors and `pt-BR`/`en` into device-protected storage. The current shell sends factory dark colors;
theme settings should pass their derived dark colors here. The native activity bundles Atkinson
Hyperlegible and Android strings, uses a live clock, and offers no silence or snooze action.

Custom sounds are copied atomically before scheduling. If the provider permission expires, keep
the last complete copy; without a copy the service tries the system alarm URI and ToneGenerator.
No network or credential-protected file is needed to ring.

To verify on a PIN-protected emulator (in addition to the JVM regression tests):

1. Install the built APK, open the app and grant notification/full-screen/overlay permissions.
2. Set a PIN in Android Settings. Save an enabled alarm for three minutes ahead. For a custom
   sound, use a readable local URI through `setAlarms`; the shell editor has no sound picker yet.
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
