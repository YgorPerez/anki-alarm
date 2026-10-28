#!/usr/bin/env bash
# Runs one emulator scenario for #6 and prints what happened.
#   test/scenario.sh <serial> locked-background   # PIN lock, app in background, screen off, alarm in 15 s
#   test/scenario.sh <serial> in-use              # unlocked, Settings in front, alarm in 15 s
#   test/scenario.sh <serial> leave [KEY]         # during a ring: starts the session, leaves, waits 14 s
#   test/scenario.sh <serial> finish              # starts the session and answers Good until dismissed
#   test/scenario.sh <serial> unlock              # wakes and unlocks with PIN 1234
#   test/scenario.sh <serial> oem                 # #35: the OEM state as adb sees it, plus the app's own reads
set -uo pipefail
S=$1; A=~/Android/Sdk/platform-tools/adb; UI="python3 -I $(dirname "$0")/ui.py -s $S"
P=dev.ygorperez.alarmprototype
sh() { $A -s "$S" shell "$@" | tr -d '\r'; }
state() {
  echo "  screen: $(sh dumpsys power | grep -m1 -o 'mWakefulness=[A-Za-z]*')"
  echo "  keyguard: $(sh dumpsys window | grep -m1 -oE 'isKeyguardShowing=[a-z]+|mKeyguardShowing=[a-z]+')"
  echo "  focus: $(sh dumpsys window | grep -m1 'mCurrentFocus' | sed 's/.*Window{[^ ]* [^ ]* //; s/}//')"
}
unlock() {
  sh input keyevent KEYCODE_WAKEUP; sleep 1; sh wm dismiss-keyguard; sleep 1
  sh input text 1234; sh input keyevent KEYCODE_ENTER; sleep 2
}
case $2 in
  unlock) unlock; state ;;
  locked-background)
    sh locksettings set-pin 1234 >/dev/null 2>&1 || true
    $A -s "$S" logcat -c
    sh am start -n $P/.MainActivity >/dev/null; sleep 4
    $UI tap "15 s"
    sh input keyevent KEYCODE_HOME; sleep 1
    sh input keyevent KEYCODE_SLEEP; sleep 2
    echo "before:"; state
    sleep 24
    echo "after ring:"; state
    $A -s "$S" logcat -d -s AlarmPrototype | sed 's/^.* AlarmPrototype: /  log: /'
    ;;
  in-use)
    unlock >/dev/null
    $A -s "$S" logcat -c
    sh am start -n $P/.MainActivity >/dev/null; sleep 4
    $UI tap "15 s"
    sh am start -a android.settings.SETTINGS >/dev/null; sleep 2
    echo "before:"; state
    sleep 24
    echo "after ring:"; state
    $A -s "$S" logcat -d -s AlarmPrototype | sed 's/^.* AlarmPrototype: /  log: /'
    ;;
  leave)
    # Expects a ring with the alarm screen visible. Starts the session, then leaves with the given key.
    key=${3:-KEYCODE_HOME}
    $UI tap "Start the session (drops the sound)" >/dev/null; sleep 2
    $A -s "$S" logcat -c
    sh input keyevent "$key"; sleep 14
    echo "after leaving with $key:"; state
    $A -s "$S" logcat -d -s AlarmPrototype | sed 's/^.* AlarmPrototype: /  log: /'
    ;;
  swipe-away)
    # During a ring: opens Recents and swipes the app's card up, then waits 40 s.
    $A -s "$S" logcat -c
    sh input keyevent KEYCODE_APP_SWITCH; sleep 3
    sh input swipe 540 1200 540 100 200; sleep 2
    sh input keyevent KEYCODE_HOME; sleep 40
    echo "after swipe-away:"; state
    echo "  process: $(sh pidof $P || echo none)"
    $A -s "$S" logcat -d -s AlarmPrototype | sed 's/^.* AlarmPrototype: /  log: /'
    ;;
  force-stop)
    $A -s "$S" logcat -c
    sh am force-stop $P; sleep 40
    echo "after force-stop:"; state
    echo "  process: $(sh pidof $P || echo none)"
    $A -s "$S" logcat -d -s AlarmPrototype | sed 's/^.* AlarmPrototype: /  log: /'
    ;;
  finish)
    sh am start -n $P/.MainActivity >/dev/null 2>&1; sleep 3
    $UI tap "Start the session (drops the sound)" >/dev/null
    for _ in 1 2 3; do sleep 1; $UI tap "Show answer" >/dev/null; sleep 1; $UI tap "Good" >/dev/null; done
    sleep 1; $A -s "$S" logcat -d -s AlarmPrototype | grep -E "DISMISSED|destroyed" | sed 's/^.* AlarmPrototype: /  log: /'
    ;;
  oem)
    echo "device: $(sh getprop ro.product.manufacturer) $(sh getprop ro.product.model), Android $(sh getprop ro.build.version.release)"
    sh getprop | grep -E 'ro\.miui\.ui\.version|ro\.mi\.os\.version|ro\.build\.version\.oneui' | sed 's/^/  prop: /'
    echo "  $(sh dumpsys package $P | grep -m1 -oE 'packageSource=[0-9]+') $(sh dumpsys package $P | grep -m1 -oE 'installerPackageName=[^ ]*')"
    echo "  stopped: $(sh dumpsys package $P | grep -m1 -oE 'stopped=[a-z]+')"
    echo "  standby bucket: $(sh am get-standby-bucket $P)"
    echo "  process: $(sh pidof $P || echo none)"
    echo "  alarms: $(sh dumpsys alarm | grep -c "$P")"
    echo "  MILLET_NO_RESTRICT_APP has app: $(sh settings get system MILLET_NO_RESTRICT_APP | grep -c "$P")"
    sh appops get $P | sed 's/^/  appops: /'
    $A -s "$S" logcat -c
    sh am start -n $P/.MainActivity >/dev/null 2>&1; sleep 4
    $UI tap "Log OEM state" >/dev/null; sleep 1
    $A -s "$S" logcat -d -s AlarmPrototype | grep 'oem:' | sed 's/^.* AlarmPrototype: /  app: /'
    ;;
esac
