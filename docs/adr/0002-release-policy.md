# Release policy: OTA updates and sideloaded APKs

Friends install a sideloaded APK from GitHub Releases. JS-only changes reach it through EAS Update.
Native code decides which updates fit, using Expo's `fingerprint` runtime policy. A release tag
ships everything at once, and CI compares fingerprints to choose between an OTA update and a new
APK. We chose this because a wrong runtime label lets an OTA update crash installed APKs, and in
an alarm app a crash is an alarm that doesn't ring. Decided in #32.

## Runtime version and channels

- `runtimeVersion` uses the `fingerprint` policy. Any change to native code, native deps or config
  plugins gives a new runtime, without anyone having to remember a bump.
- One EAS Update channel, `production`. Release APKs listen to it. Testing happens on a dev client
  or a locally built APK before tagging.

## What ships, and when

Only a `vX.Y.Z` tag ships. Merges to main don't. One tag runs, in order:

1. Deploy the Worker, then the web app, to Cloudflare.
2. Compute the fingerprint and compare it with the one recorded on the latest release that has an
   APK.
3. **Same fingerprint:** `eas update` to `production`, and a GitHub release with notes but no APK.
4. **Different fingerprint:** `expo prebuild` and Gradle on a GitHub Actions runner build a signed
   APK (keystore in repo secrets). It's attached to the GitHub release along with its fingerprint.
   No OTA update is published, because the APK already contains the JS.

versionName is the tag's version, and versionCode is major·10000 + minor·100 + patch (v1.4.2 →
10402), so later tags always install over earlier ones.

## On the phone

- **OTA updates** are checked on launch and when the app returns to the foreground, at most every 6
  hours, and downloaded in the background. They apply on the next cold start, or when the user taps
  the update card. The app never reloads on its own, and the card isn't shown while an alarm rings,
  an alarm session is open or an awake check is pending.
- **APK check:** the app reads the newest GitHub release that has an APK (the repo is public, so no
  token) and offers it only if its versionCode is above the installed one. JS-only releases have no
  APK, so a change OTA already delivered is never offered again.
- The offer is a card above the tab bar, and also on the Theme and Reliability screens, plus a button
  at the top of Settings. It's never shown during an alarm, study, the alarm editor (a restart would
  lose the draft), AnkiDroid linking (it would interrupt an import) or onboarding. Dismissing the
  card lasts until the next cold start; the Settings button stays. A new APK takes priority over a
  downloaded OTA, since it already contains the JS.
- Accepting an APK downloads it, showing the percentage, and opens Android's package installer
  (`REQUEST_INSTALL_PACKAGES`). If the installer is cancelled, the next tap reopens it without
  downloading again. An old APK keeps working. It just stops getting OTA updates.

## Bad updates

A broken OTA update is undone right away by republishing the last good update to `production` with
a script (`eas update:republish`), then fixed forward with a patch tag. expo-updates also rolls back
on its own when an update crashes at launch.

## Client and Worker compatibility

- Clients and Worker move in lockstep. A `SYNC_PROTOCOL` integer in `packages/core` is sent on every
  sync request. The Worker accepts only its own value and answers anything else with 426. The PR
  that breaks the sync API bumps it. It lives in the JS, so an OTA update is enough to catch up when
  the change is JS-only.
- On a 426 the phone shows "Sync paused: update the app", checks for an OTA update at once, and
  falls back to the APK offer. Study and alarms keep working offline, and local changes queue until
  the update.
- Consequence: a tag that bumps `SYNC_PROTOCOL` pauses sync on every phone until it restarts on the
  new update, or installs the new APK. That gap is accepted in exchange for a Worker with no old API
  versions to keep.

## Considered options

- **`appVersion` or a manual runtime version.** Simpler, but one forgotten bump after a native change
  sends JS that doesn't fit to every installed APK.
- **EAS Build.** Less Gradle setup, but a small free quota and Expo would hold the keystore.
- **Additive-only sync API with old versions kept.** Nobody loses sync, but the Worker carries every
  old endpoint. Rejected for lockstep at friends scale.
