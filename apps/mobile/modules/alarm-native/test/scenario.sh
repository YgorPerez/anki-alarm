#!/usr/bin/env bash
# The #6 adb scenarios against the real app, on an emulator (#42). Each case expects an alarm that
# is ringing with the RN alarm screen in front, and prints the native log (tag AlarmNative) plus
# what adb sees. Set the alarm up by hand: a deck with a few cards, an alarm on it a minute ahead.
#   scenario.sh <serial> leave       # Start, Home, wait 14 s: full volume and the way-back notification
#   scenario.sh <serial> idle        # Start, no answer for 24 s: full volume
#   scenario.sh <serial> answer      # Start, reveal, wait for the grades, Again: still quiet
#   scenario.sh <serial> swipe-away  # Recents, swipe the app's card away, wait 20 s
#   scenario.sh <serial> crash       # am crash mid-ring, wait 20 s: START_STICKY takes the ring over
#   scenario.sh <serial> reboot      # adb reboot mid-session, wait for boot: rings again, same ring
#   scenario.sh <serial> state       # screen, focus, process, foreground service and notifications
# The labels are pt-BR (the app's default); set START, REVEAL and AGAIN for English.
set -uo pipefail
S=$1
A=~/Android/Sdk/platform-tools/adb
UI="python3 -I $(dirname "$0")/ui.py -s $S"
P=dev.ygorperez.ankialarm
START=${START:-Começar}
REVEAL=${REVEAL:-Mostrar resposta}
AGAIN=${AGAIN:-De novo}
sh() { $A -s "$S" shell "$@" | tr -d '\r'; }
log() { $A -s "$S" logcat -d -s AlarmNative | sed 's/^.* AlarmNative: /  log: /'; }
state() {
  echo "  screen: $(sh dumpsys power | grep -m1 -o 'mWakefulness=[A-Za-z]*')"
  echo "  focus: $(sh dumpsys window | grep -m1 'mCurrentFocus' | sed 's/.*Window{[^ ]* [^ ]* //; s/}//')"
  echo "  process: $(sh pidof $P || echo none)"
  echo "  service: $(sh dumpsys activity services $P | grep -c 'ServiceRecord.*AlarmService') running"
  echo "  notifications: $(sh dumpsys notification --noredact | grep -oE "pkg=$P id=[0-9]+" | sort -u | tr '\n' ' ')"
  echo "  alarm stream: $(sh dumpsys audio | grep -m1 -A0 'player piid.*usage=USAGE_ALARM' | grep -oE 'state:[a-z]+|vol:[0-9.]+' | tr '\n' ' ')"
}
start() { $UI tap "$START" >/dev/null && sleep 2; }
case $2 in
  state) state ;;
  leave)
    start
    $A -s "$S" logcat -c
    sh input keyevent KEYCODE_HOME
    sleep 14
    echo "after leaving:"; state; log
    ;;
  idle)
    start
    $A -s "$S" logcat -c
    sleep 24
    echo "after 24 s with no answer:"; state; log
    ;;
  answer)
    start
    $A -s "$S" logcat -c
    sleep 15
    $UI tap "$REVEAL" >/dev/null; sleep 4
    $UI tap "$AGAIN" >/dev/null; sleep 8
    echo "27 s after Start, answered at 19 s:"; state; log
    ;;
  swipe-away)
    $A -s "$S" logcat -c
    sh input keyevent KEYCODE_APP_SWITCH; sleep 3
    # A fast swipe goes Home instead; while the card is in Overview the screen still counts as shown.
    sh input touchscreen swipe 540 1400 540 100 500; sleep 20
    echo "after swipe-away:"; state; log
    ;;
  crash)
    $A -s "$S" logcat -c
    sh am crash $P; sleep 20
    echo "after am crash:"; state; log
    ;;
  reboot)
    $A -s "$S" reboot
    $A -s "$S" wait-for-device
    until [ "$(sh getprop sys.boot_completed)" = 1 ]; do sleep 2; done
    sleep 15
    echo "after reboot:"; state; log
    ;;
esac
