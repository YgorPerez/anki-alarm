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
