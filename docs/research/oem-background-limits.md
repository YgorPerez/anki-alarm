# OEM background limits: what Xiaomi, Samsung, Motorola and others add

Research for ticket #35. The #6 prototype (`prototype/alarm`, `prototypes/alarm/FINDINGS.md`) showed
that the alarm works on stock Android 12 and 17 emulators. This note covers what OEM skins add on
top. Each claim cites its source and is marked with how far it can be trusted:

- **Primary:** Android docs, AOSP source, the Android CDD, or the OEM's own developer or support docs.
- **First-hand:** dontkillmyapp.com. It is written by the Sleep as Android developers from user
  reports. Pinned to [`urbandroid-team/dont-kill-my-app@3616bc8`](https://github.com/urbandroid-team/dont-kill-my-app/tree/3616bc8b3b6b3910ac204e107ff0dfd6064f877c/_vendors-content)
  and abbreviated **DKMA** below.
- **Community:** code in other open-source apps, forum posts and blogs. Not confirmed.

AOSP links point at `android16-release`: frameworks/base [`99b01a6`](https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827),
Permission module [`fd6db90`](https://android.googlesource.com/platform/packages/modules/Permission/+/fd6db90f998351ae7896543bc08d730ecbbc4f12),
Settings [`0fb38ed`](https://android.googlesource.com/platform/packages/apps/Settings/+/0fb38ed81e9b49d5da4be8f50d9d69865c1192e8).

## Answer

**Stock Android is on our side.** AOSP exempts `setAlarmClock` alarms from Doze, from every App
Standby bucket (restricted included), from battery saver and from the user's "Restricted" battery
setting. A service started by one of these alarms may start in the foreground even when the app is
background-restricted. Anything an OEM breaks beyond that is the OEM's own code.

**Xiaomi (MIUI, HyperOS) is the real risk.** Xiaomi's own developer docs say that three things are
denied by default, and the user has to switch each one on:

1. **Autostart**, which also blocks system broadcasts. Without it `LOCKED_BOOT_COMPLETED`,
   `BOOT_COMPLETED`, `TIME_SET` and `TIMEZONE_CHANGED` don't reach us. After a reboot nothing
   re-arms, so the alarm never rings.
2. **Show on lock screen.** Without it the alarm screen can't show over the keyguard.
3. **Open new windows while running in the background.** Without it our `startActivity` from the
   service is blocked.

DKMA adds the battery saver ("No restrictions") and locking the app in Recents. Swiping the app away
or "clear all" may force-stop it, which would drop every alarm. That is community-reported only.

**Samsung (One UI)** is mostly fine since One UI 6. Samsung's developer docs guarantee foreground
services for apps that target Android 14 and follow the FGS type rules, which we do. The risks are
"Sleeping apps", and above all "Deep sleeping apps": Samsung says deep-sleeping apps "can't perform
any activities". Samsung moves apps there on its own after 16 days unused. An alarm app the user
opens every morning shouldn't qualify, but a weekend-only alarm might. The fix is "Never sleeping
apps", and Samsung documents a deep link to it.

**Motorola** is near-stock. DKMA reports one extra killer, "Battery care" / "Improve battery while
inactive", and recommends setting the app's battery use to "Unrestricted".

**A platform rule bites every brand: restricted settings.** The Android 15 and 16 CDDs *require*
"Display over other apps" to be a restricted setting for apps installed from a downloaded or local
APK. That is exactly how our friends install. On Android 15+ the overlay toggle is greyed out until
the user opens App info → ⋮ → "Allow restricted settings". That menu item only appears after the
user has tried the toggle once. Onboarding has to walk through this. One UI 8.5 doesn't enforce it: on a Galaxy
S24 Ultra the toggle turned on with no dialog (see "Real-phone results").

**Detection:** most settings can be read. Android exposes battery optimization, background
restriction, the standby bucket, full-screen intent and the overlay permission. On Xiaomi,
hidden-API reflection reads the background-start (10021) and lock-screen (10020) app-ops, and
Telegram does exactly that. The HyperOS "No restrictions" list sits in a readable system setting.
Autostart can only be read by reflection into MIUI classes. Samsung's sleep lists can't be read
directly, but CDD 3.5.1 says OEM restrictions must make `isBackgroundRestricted()` return true. Deep
links exist for every screen. Xiaomi documents two intents, and Samsung documents one.

### Proposed spec changes

1. **Onboarding gets an OEM step.** After notifications and overlay, the app reads
   `Build.MANUFACTURER` and walks the user through the vendor's list below, one screen per setting.
   It re-checks each setting on resume and shows ✓ or "can't check, confirm by hand". Where it can't
   detect a setting, it asks the user to confirm.
2. **Overlay onboarding handles restricted settings.** On Android 13+ the app reads its own
   `getInstallSourceInfo().packageSource`. If it is `PACKAGE_SOURCE_LOCAL_FILE` or
   `PACKAGE_SOURCE_DOWNLOADED_FILE` and the device runs Android 15+, the app shows the three-step
   unlock (try the toggle, ⋮ → Allow restricted settings, toggle again) before it opens the overlay
   page. It re-checks `canDrawOverlays()` first, since One UI 8.5 grants the toggle directly.
3. **`getPermissions()` in ADR 0005 grows OEM fields:** `backgroundRestricted`, `standbyBucket`,
   `miuiBackgroundStart`, `miuiShowWhenLocked`, `miuiAutostart`, `miuiNoRestrictions`,
   `installSource`. Each is tri-state: granted, denied or unknown. `request(kind)` gains the matching
   deep links, with fallbacks to App info.
4. **Settings shows a "Reliability" check** that re-runs the same checks. Xiaomi resets settings
   after OS updates and Samsung can re-add apps to sleep lists, so it's worth running after an update.
   DKMA reports both.
5. **Boot must not start a `mediaPlayback` FGS.** This holds on every brand. The prototype already
   tries `systemExempted` first; keep it that way, since Android 15 forbids `mediaPlayback` from
   `BOOT_COMPLETED` receivers.

## Detail

### What stock Android guarantees (the baseline OEMs change)

- `setAlarmClock` alarms "continue to fire normally. The system exits Doze shortly before those
  alarms fire" ([Doze docs](https://developer.android.com/training/monitoring-device-state/doze-standby)).
  "The system identifies these alarms as the most critical ones and leaves low-power modes if
  necessary" ([alarms docs](https://developer.android.com/develop/background-work/services/alarms)). Primary.
- In `AlarmManagerService`, alarm clocks are exempt from App Standby (`isExemptFromAppStandby`:
  `a.alarmClock != null`), from battery saver, and from background restriction ("Don't defer alarm
  clocks")
  ([L4332](https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/apex/jobscheduler/service/java/com/android/server/alarm/AlarmManagerService.java#4332),
  [L4146](https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/apex/jobscheduler/service/java/com/android/server/alarm/AlarmManagerService.java#4146),
  [L4159](https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/apex/jobscheduler/service/java/com/android/server/alarm/AlarmManagerService.java#4159)). Primary.
  The [App Standby doc](https://developer.android.com/topic/performance/appstandby) says the
  restricted bucket allows one alarm a day. The source shows alarm clocks bypass that quota, and
  `USE_EXACT_ALARM` keeps an app out of the restricted bucket anyway.
- A service started from an alarm clock may start even when the app is background-restricted
  (`!isTempAllowedByAlarmClock(appUid)` in
  [ActiveServices L1026](https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/services/core/java/com/android/server/am/ActiveServices.java#1026)).
  "Exact alarms aren't affected by foreground service launch restrictions"
  ([alarms docs](https://developer.android.com/develop/background-work/services/alarms)). Primary.
- Android 15: `BOOT_COMPLETED` receivers can't start `mediaPlayback` (or `dataSync`, `camera`,
  `phoneCall`, `mediaProjection`, `microphone`) services; it throws
  `ForegroundServiceStartNotAllowedException`
  ([Android 15 behavior changes](https://developer.android.com/about/versions/15/behavior-changes-15#fgs-boot-completed)).
  `systemExempted` is not on the list. Primary.
- Background activity starts are allowed when "the app has the `SYSTEM_ALERT_WINDOW` permission
  granted by the user" ([background starts](https://developer.android.com/guide/components/activities/background-starts)). Primary.
- `USE_FULL_SCREEN_INTENT` is "enabled by default" for apps installed on Android 14. The Play Store
  revokes it from apps that aren't calling or alarm apps. OEMs "must specify which apps qualify"
  ([AOSP FSI limits](https://source.android.com/docs/core/permissions/fsi-limits)). A sideloaded APK
  never meets Play's revocation step, so it keeps the default, as the prototype saw. Primary, but
  an OEM may choose a different default (see Samsung and Xiaomi below).
- **CDD 3.5.1, Application Restriction.** An OEM restriction that is stricter than the restricted
  bucket MUST let the user see the list of restricted apps and switch the restriction off per app.
  It MUST NOT be applied without "evidence of poor system health behavior". It "MUST return true
  for `ActivityManager.isBackgroundRestricted()`", and the OEM MUST publish a document describing it
  ([Android 16 CDD §3.5.1](https://source.android.com/docs/compatibility/16/android-16-cdd#351_application_restriction)).
  Primary. Samsung's developer page reads like that document. We found no Xiaomi equivalent.
- **AOSP DeskClock** uses the same pieces we do: `directBootAware` alarm activity and service,
  `LOCKED_BOOT_COMPLETED`, `showWhenLocked`, `USE_FULL_SCREEN_INTENT`, `SCHEDULE_EXACT_ALARM`. It has
  no OEM workarounds; OEMs ship their own clock app instead
  ([DeskClock manifest](https://android.googlesource.com/platform/packages/apps/DeskClock/+/76ccf26b51403838ae8890e8ba286dea85d53c18/AndroidManifest.xml)).

### Restricted settings (all brands, Android 13+)

- On Android 13 and 14 restricted settings cover accessibility and the notification listener,
  neither of which we use ([Google support](https://support.google.com/android/answer/12623953)).
  The list itself comes from the Android Authority and Esper coverage, so it is community-sourced.
- From Android 15 the CDD makes it a MUST for "Display over other apps
  (`AppOpsManager.OPSTR_SYSTEM_ALERT_WINDOW`)". It applies to apps installed from a download
  (`PACKAGE_SOURCE_DOWNLOADED_FILE`) or a local file (`PACKAGE_SOURCE_LOCAL_FILE`). It MUST be on by
  default, and the user can lift it only from the app's App info page
  ([Android 15 CDD §9.8](https://source.android.com/docs/compatibility/15/android-15-cdd),
  [Android 16 CDD §9.8](https://source.android.com/docs/compatibility/16/android-16-cdd), requirements
  9.8/H-0-1 to H-0-4). Primary. The same section only STRONGLY RECOMMENDS treating
  `USE_FULL_SCREEN_INTENT` and `SCHEDULE_EXACT_ALARM` the same way (9.8/H-0-5). Those two are granted
  at install for us, so that only matters if the user turns them off and wants them back.
- AOSP implements it in `EnhancedConfirmationService`. `SYSTEM_ALERT_WINDOW` is in the protected
  set, and local-file and downloaded-file installs are "always considered dangerous"
  ([L133, L387](https://android.googlesource.com/platform/packages/modules/Permission/+/fd6db90f998351ae7896543bc08d730ecbbc4f12/service/java/com/android/ecm/EnhancedConfirmationService.java#387)).
  Settings' overlay page passes the app-op as its ECM key
  ([`AppOpPermissionAppList.kt` L52](https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/packages/SettingsLib/SpaPrivileged/src/com/android/settingslib/spaprivileged/template/app/AppOpPermissionAppList.kt#52)). Primary.
- **The "Allow restricted settings" menu item only shows after the user has hit the block once.**
  It needs the ECM state `GUARDED_AND_ACKNOWLEDGED`
  ([`AppInfoDashboardFragment` L542](https://android.googlesource.com/platform/packages/apps/Settings/+/0fb38ed81e9b49d5da4be8f50d9d69865c1192e8/src/com/android/settings/applications/appinfo/AppInfoDashboardFragment.java#542),
  [ECM L322](https://android.googlesource.com/platform/packages/modules/Permission/+/fd6db90f998351ae7896543bc08d730ecbbc4f12/service/java/com/android/ecm/EnhancedConfirmationService.java#322)). Primary.
  So the steps are: open the overlay page and tap the toggle, then dismiss the "Restricted setting"
  dialog. Open App info → ⋮ → Allow restricted settings, and confirm with PIN or fingerprint. Back on
  the overlay page, turn it on
  ([Google support](https://support.google.com/android/answer/12623953)).
- **The app can predict it.** `PackageManager.getInstallSourceInfo(ownPackage).packageSource` (API
  33) tells the app how it was installed. The ECM state itself is a system API, so the app can't
  read it.
- **Unconfirmed:** whether One UI and HyperOS show the same menu item and wording. Whether Xiaomi's
  own installer (`com.miui.packageinstaller`) records `PACKAGE_SOURCE_LOCAL_FILE`. Whether
  installing through a store-like app (Obtainium, F-Droid) avoids the restriction. The prototype's
  emulators granted overlay through adb, so they never hit this UI.

### Xiaomi: MIUI and HyperOS

Xiaomi's developer docs (primary):

- **Autostart** is "not granted by default" (默认不开放自启动权限). It covers starts at boot *and*
  "receiving system broadcasts" (接收系统广播). Developers should send the user to the autostart page
  with action `miui.intent.action.OP_AUTO_START` and `CATEGORY_DEFAULT`
  ([Xiaomi adaptation FAQ, item 12](https://dev.mi.com/docs/appsmarket/technical_docs/adaptation_FAQ/)).
  So with Autostart off, our `BootReceiver` never runs, and a night reboot means no alarm.
- **Show on lock screen.** "By default an Activity can't be shown on the lock screen"; the user has
  to grant it (item 9). There is "no query interface" for permission state (item 10). Developers
  should open the permission editor with `miui.intent.action.APP_PERM_EDITOR` and extra
  `extra_pkgname` (item 10, same page).
- **Background pop-up.** The background pop-up permission (后台弹出页面) "defaults to denied". Only
  allowlisted categories are exempt (lyrics, fitness, VoIP calls); alarm apps are not named, and
  special cases should email `miui-security-open@xiaomi.com`
  ([HyperOS doc pId=1625](https://dev.mi.com/xiaomihyperos/documentation/detail?pId=1625), updated 2024-11-27).
- **Process kills.** Xiaomi lists `SwipeUpClean` (swipe in Recents) and `OneKeyClean` (clear all)
  as user-triggered kills. They show up as `am_kill` in `adb logcat -b events`. The advice is to
  have users enable Autostart so the app can restart after one
  ([HyperOS doc pId=1607](https://dev.mi.com/xiaomihyperos/documentation/detail?pId=1607), updated 2024-09-25).
  The doc doesn't say whether these kills are a force-stop that drops alarms.
- **Overlay.** "Display over other apps" is controlled by Security Center (FAQ item 6).
- **Alarm alignment.** MIUI may batch alarms that fall close together (item 11). Nothing there
  says alarm clocks are exempt or included.

dontkillmyapp ([xiaomi/user.md](https://github.com/urbandroid-team/dont-kill-my-app/blob/3616bc8b3b6b3910ac204e107ff0dfd6064f877c/_vendors-content/xiaomi/user.md)), first-hand:

- It gives Xiaomi the worst rating and says "in default settings, background processing simply
  does not work right" ([explanation.md](https://github.com/urbandroid-team/dont-kill-my-app/blob/3616bc8b3b6b3910ac204e107ff0dfd6064f877c/_vendors-content/xiaomi/explanation.md)).
- Fixes it lists: lock the app in Recents (drag down or long-press → padlock), so "clear all"
  spares it. Set the battery saver to "No restrictions". Turn on Autostart (MIUI 14: App info → App
  permissions → Background autostart). It also mentions the hidden "MIUI optimizations" developer
  toggle.

Community (not confirmed):

- **Op codes.** `OP_SHOW_WHEN_LOCKED = 10020`, `OP_BACKGROUND_START_ACTIVITY = 10021`,
  `OP_AUTO_START = 10008`. They are read with the hidden but allowed
  `AppOpsManager.checkOpNoThrow(int, int, String)`, which AOSP marks `@UnsupportedAppUsage` with no
  SDK cap ([AppOpsManager L9980](https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/app/AppOpsManager.java#9980)).
  Telegram ships this
  ([`XiaomiUtilities.java`](https://github.com/DrKLO/Telegram/blob/3de37c8cfb039452be7398909461da6288babf15/TMessagesProj/src/main/java/org/telegram/messenger/XiaomiUtilities.java)).
  Telegram's call screen gives up when 10020 is denied and the phone is locked
  ([`VoIPService.java` L1194](https://github.com/DrKLO/Telegram/blob/3de37c8cfb039452be7398909461da6288babf15/TMessagesProj/src/main/java/org/telegram/messenger/voip/VoIPService.java#L1194)).
  AutoJs6 and LinkSheet use 10021 the same way
  ([AutoJs6](https://github.com/SuperMonster003/AutoJs6/blob/ed3eb10e88db5a8425fd94bdddefa4176e5e1c94/app/src/main/java/org/autojs/autojs/permission/XiaomiBackgroundPopupPermission.kt),
  [LinkSheet](https://github.com/LinkSheet/LinkSheet/blob/d51d61a6153837f32dc1f56d7b55df01ed763354/features/devicecompat/src/main/kotlin/app/linksheet/feature/devicecompat/miui/MiuiCompat.kt)).
  AutoJs6 also tries the explicit component `com.miui.securitycenter/com.miui.permcenter.permissions.PermissionsEditorActivity`.
- **Autostart state.** It can be read by reflection on `android.miui.AppOpsUtils.getApplicationAutoStart(Context, String)`;
  0 means enabled. This needs a hidden-API bypass library and is tested only up to MIUI 14
  ([XomaDev/MIUI-autostart](https://github.com/XomaDev/MIUI-autostart/blob/5170cc6b8bffa6744d57dd91e0b11ff9233ae171/library/src/main/kotlin/xyz/kumaraswamy/autostart/Autostart.kt), linked from DKMA's
  [dev.md](https://github.com/urbandroid-team/dont-kill-my-app/blob/3616bc8b3b6b3910ac204e107ff0dfd6064f877c/_vendors-content/xiaomi/dev.md)).
  The explicit autostart component is
  `com.miui.securitycenter/com.miui.permcenter.autostart.AutoStartManagementActivity`
  ([AutoStarter](https://github.com/judemanutd/AutoStarter/blob/ea5fca55457facb6f97555e20dcd231b39c6995e/autostarter/src/main/java/com/judemanutd/autostarter/AutoStartPermissionHelper.kt)).
- **"No restrictions".** The list sits in `Settings.System` key `MILLET_NO_RESTRICT_APP`, a
  comma-separated list of packages. The per-app battery saver page is
  `com.miui.powerkeeper/.ui.HiddenAppsConfigActivity` with extras `package_name` and
  `package_label`. FlClash (59k stars) also notes that on Xiaomi the Android battery-optimization
  allowlist alone "does not stop PowerKeeper freezing it"
  ([FlClash `BatteryPlugin.kt`](https://github.com/chen08209/FlClash/blob/d3fa2252b0b2735b086828e0bb3bb17179da07e7/android/app/src/main/kotlin/com/follow/clash/plugins/BatteryPlugin.kt)).
- **Swipe-away.** On Xiaomi, swiping from Recents is reported to force-stop the app and cancel its
  alarms
  ([B4X forum](https://b4x.com/android/forum/threads/how-to-prevent-a-app-from-killing-by-xiaomi-both-miui-and-hyper-os.169194),
  [Stack Overflow 2018](https://kiwix.lema.org/stackoverflow.com_en_all_2023-11/questions/49720644/xiaomi-redmi-4x-unexplainable-behaviour-with-broadcastreceiver)).
  Not confirmed for HyperOS.
- **HyperOS detection.** A device is MIUI if `ro.miui.ui.version.name` or `ro.miui.ui.version.code`
  is set (Telegram, LinkSheet). Whether HyperOS still sets them, or only `ro.mi.os.version.*`, is
  unconfirmed. `Build.MANUFACTURER == "Xiaomi"` (brands Xiaomi, Redmi, POCO) is the safe first test.

### Samsung: One UI

Samsung's developer docs ([Samsung Application Management](https://developer.samsung.com/mobile/app-management.html)), primary:

- **Sleeping apps.** Apps "not used for about 3 days and causing poor system health" go to
  sleeping. "A bucket restriction applies … Job, Alarm, and Foreground-service are restricted", and
  the page links Android's *restricted* bucket. In AOSP the restricted bucket does not stop alarm
  clocks (see above). Whether Samsung's version honours that is the open question.
- **Deep sleeping apps.** Apps unused for "16 days, but subject to change" go to deep sleep. They
  "only become active when the user opens them … can't perform any activities, including
  notifications". Assume this kills alarms.
- **Exceptions.** Settings → Device care (Battery and device care) → Battery → Background usage
  limits → Never sleeping apps
  ([Samsung support](https://www.samsung.com/us/support/answer/ANS10003442/)).
- **Deep link.** Action `com.samsung.android.sm.ACTION_OPEN_CHECKABLE_LISTACTIVITY`, package
  `com.samsung.android.lool`, int extra `activity_type`: 0 sleeping, 1 deep sleeping, 2 never
  sleeping, 4 "Apps slated for deep sleep" (confirmed on One UI 8.5).
- **One UI 6.** "Since One UI 6.0, foreground services of apps targeting Android 14 will be
  guaranteed to work as intended so long as they are developed according to Android's new
  foreground service API policy." The same commitment appears in
  [Google's blog](https://android-developers.googleblog.com/2023/05/improving-consistency-of-background-work-on-android.html).

dontkillmyapp ([samsung/explanation.md](https://github.com/urbandroid-team/dont-kill-my-app/blob/3616bc8b3b6b3910ac204e107ff0dfd6064f877c/_vendors-content/samsung/explanation.md),
[user.md](https://github.com/urbandroid-team/dont-kill-my-app/blob/3616bc8b3b6b3910ac204e107ff0dfd6064f877c/_vendors-content/samsung/user.md)), first-hand:

- Before One UI 6, an unused alarm app stopped ringing after ~3 days ("you won't use your alarm
  clock for the weekend plus 1 day and bang! no alarms"). Samsung "may re-add" apps to the restricted
  lists after a firmware update.
- Android 13/14: per-app battery set to Unrestricted, Adaptive battery, "Remove permissions if app
  is unused", and the sleeping lists. "Keep open" (lock in Recents) is listed for Android 14.
  DKMA asks for reports on whether One UI 6 kept its promise.
- No developer-side fix is known ([dev.md](https://github.com/urbandroid-team/dont-kill-my-app/blob/3616bc8b3b6b3910ac204e107ff0dfd6064f877c/_vendors-content/samsung/dev.md)).

Detection: no Samsung API reads the lists. `UsageStatsManager.getAppStandbyBucket()` should report
`STANDBY_BUCKET_RESTRICTED` (45) for a sleeping app, since Samsung calls it a bucket restriction.
CDD 3.5.1 says deep sleep should make `ActivityManager.isBackgroundRestricted()` true. Both are
inferences and need a device check.

### Motorola: My UX, near-stock

dontkillmyapp ([motorola/user.md](https://github.com/urbandroid-team/dont-kill-my-app/blob/3616bc8b3b6b3910ac204e107ff0dfd6064f877c/_vendors-content/motorola/user.md)), first-hand. We found no Motorola developer doc.

- **"Improve battery while inactive".** On some models the *Battery care* app
  (`com.motorola.batterycare`) "does seem to kill the apps even if you disable the option". The only
  fix DKMA gives is uninstalling it over adb, which is not something we can ask friends to do.
- **Battery usage.** Use App info → App battery usage → allow background usage, then tap the row →
  "Unrestricted". Turn off Adaptive battery, and remove any "Background restriction". Some models have
  a "Managing background apps" page that is only reachable through Settings search.
- DKMA rates Motorola 3 of 5 (Xiaomi and Samsung get 5) and knows no developer-side fix.

### Others: Oppo/ColorOS, Realme, OnePlus/OxygenOS, Vivo/OriginOS (short)

From dontkillmyapp ([oneplus](https://github.com/urbandroid-team/dont-kill-my-app/blob/3616bc8b3b6b3910ac204e107ff0dfd6064f877c/_vendors-content/oneplus/user.md),
[oppo](https://github.com/urbandroid-team/dont-kill-my-app/blob/3616bc8b3b6b3910ac204e107ff0dfd6064f877c/_vendors-content/oppo/user.md),
[realme](https://github.com/urbandroid-team/dont-kill-my-app/blob/3616bc8b3b6b3910ac204e107ff0dfd6064f877c/_vendors-content/realme/user.md),
[vivo](https://github.com/urbandroid-team/dont-kill-my-app/blob/3616bc8b3b6b3910ac204e107ff0dfd6064f877c/_vendors-content/vivo/user.md)), first-hand, thin:

- **OnePlus:** rated 5 of 5 (bad). Settings get reset by firmware updates. Swiping from Recents may
  kill the app, depending on the "Recent app clear behaviour" setting. Fixes: App Auto-Launch, battery
  optimization off, Advanced optimization off, and lock the app in Recents.
- **Oppo/ColorOS:** "Allow Auto Start-up" and power saver settings. Only old models are documented.
- **Realme:** "Display pop-up windows of applications running in the background" (Special access)
  "needs to be turned on for alarm apps", plus App battery management and App quick freeze.
- **Vivo:** "The apps loading from the background need a special permission for Autostart", plus
  Unrestricted battery, Background power usage, and locking the app in Recents.
- Autostart components (community, [AutoStarter](https://github.com/judemanutd/AutoStarter/blob/ea5fca55457facb6f97555e20dcd231b39c6995e/autostarter/src/main/java/com/judemanutd/autostarter/AutoStartPermissionHelper.kt),
  last updated 2021):
  - Oppo: `com.coloros.safecenter/.permission.startup.StartupAppListActivity`, then
    `com.coloros.safecenter/.startupapp.StartupAppListActivity`, then
    `com.oppo.safe/.permission.startup.StartupAppListActivity`.
  - Vivo: `com.iqoo.secure/.ui.phoneoptimize.AddWhiteListActivity`, then
    `com.vivo.permissionmanager/.activity.BgStartUpManagerActivity`.
  - OnePlus: `com.oneplus.security/.chainlaunch.view.ChainLaunchAppListActivity`.

  None of them can be read back. Treat them as best-effort deep links with an App info fallback.

## Per-OEM table

"Detect" means the app can read the state. "Link" means it can open the exact screen.

| OEM | What breaks | Setting that fixes it | Detect | Link |
|---|---|---|---|---|
| All, Android 15+ (sideloaded) | Overlay toggle greyed out | App info → ⋮ → Allow restricted settings (after one failed try) | Predict from own `packageSource`; result via `Settings.canDrawOverlays()` | `ACTION_APPLICATION_DETAILS_SETTINGS`, then `ACTION_MANAGE_OVERLAY_PERMISSION` |
| All | Full-screen intent off (user or OEM default) | Full-screen notifications | `NotificationManager.canUseFullScreenIntent()` | `ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT` |
| All | Battery "Restricted" / OEM restriction | Battery: Unrestricted | `ActivityManager.isBackgroundRestricted()`, `PowerManager.isIgnoringBatteryOptimizations()` | `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` |
| Xiaomi | No re-arm after reboot, time or zone change; maybe no restart after a kill | Autostart on | Reflection on `android.miui.AppOpsUtils` (MIUI ≤14 tested), or op 10008 (community) | `miui.intent.action.OP_AUTO_START` (official) |
| Xiaomi | Alarm screen doesn't show over the lock screen | Show on lock screen | Op 10020 via `checkOpNoThrow` (community) | `miui.intent.action.APP_PERM_EDITOR` + `extra_pkgname` (official) |
| Xiaomi | `startActivity` over an unlocked phone blocked even with overlay | Open new windows while running in the background | Op 10021 (community) | Same permission editor |
| Xiaomi | PowerKeeper freezes or kills the app | Battery saver: No restrictions | `Settings.System` `MILLET_NO_RESTRICT_APP` (community) | `com.miui.powerkeeper/.ui.HiddenAppsConfigActivity` (community) |
| Xiaomi | "Clear all" or swipe may force-stop and drop alarms (community) | Lock the app in Recents | No | No; explain with a picture |
| Samsung | Deep sleeping: app inactive in the background (official); sleeping: Job, Alarm and FGS restricted (official, alarm clock exemption unknown) | Never sleeping apps; per-app battery Unrestricted | Inferred: standby bucket 45, `isBackgroundRestricted()` | `com.samsung.android.sm.ACTION_OPEN_CHECKABLE_LISTACTIVITY` / `com.samsung.android.lool`, `activity_type=2` (official) |
| Samsung | Unknown: swipe-away and full-screen intent default on One UI 6+ | "Keep open" in Recents (DKMA) | n/a | n/a |
| Motorola | Battery care kills (DKMA) | Battery: Unrestricted; turn off "Improve battery while inactive" and Adaptive battery | `isBackgroundRestricted()`, battery optimization | App info only |
| OnePlus, Oppo, Realme, Vivo | Autostart, background pop-ups, recents-clear kills (DKMA) | Auto-launch / Autostart; background pop-ups (Realme, Vivo); lock in Recents | No | Community components above, App info fallback |

## Onboarding steps, per OEM

Each step says why it matters, opens the screen, and re-checks on return. Steps the app can't check
end with "Done" / "I couldn't find it".

**Every phone**

1. Notifications (runtime prompt).
2. Display over other apps. On Android 15+ with a sideloaded install, first explain the restricted
   settings unlock. Then open the overlay page. If the toggle is blocked, open App info and point at
   ⋮ → Allow restricted settings. Then go back to the overlay page.
3. If `canUseFullScreenIntent()` is false, open the full-screen intent page.
4. Battery: open the "ignore optimizations" prompt. If `isBackgroundRestricted()`, open App info →
   Battery → Unrestricted.

**Xiaomi / Redmi / POCO, after the above**

5. Autostart (`OP_AUTO_START`). Say plainly: "without this, the alarm won't ring after the phone
   restarts".
6. Permission editor (`APP_PERM_EDITOR`): turn on "Show on lock screen" and "Open new windows while
   running in the background". Re-check ops 10020 and 10021.
7. Battery saver → No restrictions (PowerKeeper page, App info fallback). Re-check
   `MILLET_NO_RESTRICT_APP`.
8. Lock the app in Recents (picture, no check).

**Samsung, after the above**

5. Never sleeping apps (deep link, `activity_type=2`): add the app.
6. Optional: "Keep open" in Recents. Can't be checked.

**Motorola, after the above**

5. App battery usage → Unrestricted (App info). If a "Improve battery while inactive" setting
   exists, turn it off.

**OnePlus / Oppo / Realme / Vivo, after the above**

5. Auto-launch / Autostart (best-effort component). On Realme and Vivo, also the background pop-up
   permission. Lock the app in Recents.

## Real-phone results

### Samsung Galaxy S24 Ultra (SM-S928B), Android 16, One UI 8.5, 2026-10-28

The prototype at `prototype/alarm` `8c83081`, silent mode on. Battery set to "Optimized" from check 7
on; before that the app was on the allowlist.

| Check | Result |
| --- | --- |
| 1. Sideload and restricted settings | APK opened from My Files: `packageSource=3` (local file), installer `com.google.android.packageinstaller`, originating `com.sec.android.app.myfiles`. Play Protect warned during install. "Appear on top" turned on with no "Restricted setting" dialog, and App info's ⋮ menu has no "Allow restricted settings" item. The app-op `ACCESS_RESTRICTED_SETTINGS` still reads `deny` with a reject time. One UI 8.5 doesn't apply the CDD 9.8 overlay restriction. Full-screen intent and exact alarms granted at install. |
| 2. Locked, screen off | Fired on time; alarm screen over the keyguard within 1.5 s; plays with the ringer on silent. |
| 3. Unlocked, Settings in front | `startActivity` from the service got through; alarm screen in front within 1.5 s. |
| 4. Swipe-away and Close all | Swiping the card mid-ring removed only the task (`onTaskRemoved`). The process and service stayed up, and the watchdog reopened the alarm screen. "Close all" while idle killed the process (`am_kill … remove task`) without a force-stop (`stopped=false`); the alarm stayed registered and rang on time. |
| 5. Process death mid-ring | `am crash` during a ring: `Scheduling restart of crashed service … in 1000ms`, `START_STICKY` restart, ring and alarm screen back. |
| 11. Deep links | `activity_type` 0, 1, 2 and 4 open the lists named above. `ACTION_BATTERY` opens Device care's battery page. |

Not run: 6 (Direct Boot reboot; Samsung has no autostart block and stock behaviour is covered by
the #6 emulator runs), 7 (deep Doze; `force-idle` failed while "stay awake" kept the screen on, and
AOSP exempts `setAlarmClock`), 8 (the sleeping lists). Check 8 is the open Samsung risk: until it is
run, onboarding should send Samsung users to "Never auto sleeping apps".

## Still needs a real phone

The prototype's `test/scenario.sh` has `locked-background`, `in-use`, `leave`, `swipe-away`,
`force-stop`, `finish` and `unlock`. Before the run, add these to the prototype's `getState()`: the
OEM reads listed in proposed change 3, plus ops 10020, 10021 and 10008 and `packageSource`. Then
each check reads them as well as the log. Useful adb on every device:
`dumpsys alarm | grep -A4 dev.ygorperez.alarmprototype` (is the alarm still registered),
`dumpsys package dev.ygorperez.alarmprototype | grep -E "stopped=|packageSource"`,
`am get-standby-bucket dev.ygorperez.alarmprototype`, `appops get dev.ygorperez.alarmprototype`, and
`logcat -b events | grep am_kill` (Xiaomi's documented kill reasons).

Run on one Xiaomi with HyperOS (MIUI 14 too if one is at hand), one Samsung with One UI 6 or later,
and one Motorola. Run on the phone's **default settings** first, then with each fix applied.

1. **Sideload and restricted settings (all three).** Install the APK the way friends will, by
   downloading it in the browser and opening it, not with `adb install`. Then
   `dumpsys package … | grep packageSource` and `appops get … ACCESS_RESTRICTED_SETTINGS`. In the UI,
   try the overlay toggle and confirm the ⋮ → "Allow restricted settings" path and its wording. Also
   record `canUseFullScreenIntent()` and exact-alarm state at install.
2. **Locked, screen off, defaults (all).** Run `scenario.sh <serial> locked-background`. On Xiaomi,
   run it with "Show on lock screen" off, then on. Does the full-screen intent open the alarm over
   the keyguard, or is it heads-up only?
3. **Unlocked, in use (all).** Run `scenario.sh <serial> in-use` with overlay granted. On Xiaomi,
   run it with "Open new windows while running in the background" off, then on. Does
   `startActivity` get through?
4. **Swipe-away and clear-all (all).** Start a ring, then run `scenario.sh <serial> swipe-away`.
   Repeat with the Recents "clear all" button (by hand, then the same checks), and on Xiaomi with the
   app locked in Recents. Check `pidof`, `stopped=` and `dumpsys alarm`. Did the ring continue and
   are future alarms still registered? Then schedule an alarm for +2 min, clear all while it's idle,
   and see whether it rings.
5. **Process death and `START_STICKY` (all).** During a ring, run
   `adb shell am crash dev.ygorperez.alarmprototype`, or wait for an OEM kill found in 4. Does the
   service come back ("service restarted … START_STICKY" in the log) and ring again?
6. **Direct Boot (all).** Set a PIN, schedule an alarm for 3 minutes after the reboot, `adb reboot`,
   and don't unlock. Watch `adb logcat -s AlarmPrototype` (logcat works before unlock) and
   `dumpsys alarm`. Is `LOCKED_BOOT_COMPLETED` delivered, re-armed and rung? On Xiaomi, run it with
   Autostart off, then on. Expect no re-arm with it off. Also run `adb shell cmd alarm set-time <ms>` and
   `cmd alarm set-timezone <tz>` with Autostart off to see if `TIME_SET` and `TIMEZONE_CHANGED` arrive.
7. **Overnight deep Doze (all).** Unplug, schedule an alarm 6–8 h ahead, and leave the phone idle
   overnight on default settings. On a cable you can also force it:
   `dumpsys battery unplug; dumpsys deviceidle force-idle` with an alarm +30 min. Did it ring on time?
   Check the journal's wall time against the scheduled time.
8. **Samsung sleep lists.** Use the deep link to add the app to "Sleeping apps", then run 7 with a
   +10 min alarm and `dumpsys battery unplug`. Record the standby bucket and `isBackgroundRestricted()`.
   Repeat with "Deep sleeping apps". This tells us whether alarm clocks survive each list, and whether
   the app can detect them.
9. **Xiaomi battery saver.** With the default saver, then "No restrictions", schedule +30 min, lock
   the screen and leave it unplugged. Check `settings get system MILLET_NO_RESTRICT_APP` in both states.
10. **Motorola battery care.** If the model has "Improve battery while inactive", run 7 with it on.
11. **Deep links (all).** From adb, open each one and confirm the right screen, for example
    `am start -a miui.intent.action.OP_AUTO_START`,
    `am start -a miui.intent.action.APP_PERM_EDITOR --es extra_pkgname dev.ygorperez.alarmprototype`,
    `am start -n com.miui.powerkeeper/.ui.HiddenAppsConfigActivity --es package_name dev.ygorperez.alarmprototype`,
    `am start -a com.samsung.android.sm.ACTION_OPEN_CHECKABLE_LISTACTIVITY -p com.samsung.android.lool --ei activity_type 2`.
    Also check whether `ro.miui.ui.version.name` and `ro.miui.ui.version.code` are set on HyperOS
    (`getprop | grep -E "miui|mi.os"`).
12. **After an OS update (when one comes).** Re-read every setting, to confirm DKMA's "settings get
    reset" reports for Xiaomi, Samsung and OnePlus.
