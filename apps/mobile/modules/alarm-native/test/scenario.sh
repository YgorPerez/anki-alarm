#!/usr/bin/env bash
# The #6 adb scenarios against the real app, on an emulator (#42). Each case expects an alarm that
# is ringing with the RN alarm screen in front, and prints the native log (tag AlarmNative) plus
# what adb sees. Set the alarm up by hand: a deck with a few cards, an alarm on it a minute ahead.
# No case sleeps a fixed time: each waits, up to a timeout, for the native log line or screen it
# checks, and says so when it times out.
#   scenario.sh <serial> leave       # Start, Home: full volume and the way-back notification
#   scenario.sh <serial> idle        # Start, no answer: full volume after the idle time
#   scenario.sh <serial> answer      # Start, reveal, Again: the idle time counts from the answer
#   scenario.sh <serial> swipe-away  # Recents, swipe the app's card away: the service keeps the ring
#   scenario.sh <serial> crash       # am crash mid-ring: START_STICKY takes the ring over
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
# Polls `command...` once a second until it succeeds, for at most `seconds`.
wait_for() {
  local seconds=$1 what=$2 deadline=$((SECONDS + $1))
  shift 2
  until "$@"; do
    if ((SECONDS >= deadline)); then
      echo "  timed out after ${seconds}s waiting for $what"
      return 1
    fi
    sleep 1
  done
}
logged() { log | grep -qE "$1"; }
shows() { $UI has "$1"; }
recents() { sh dumpsys window | grep -m1 'mCurrentFocus' | grep -qiE 'recents|launcher|quickstep'; }
booted() { [ "$(sh getprop sys.boot_completed)" = 1 ]; }
# The session started: native logs it once the sound and vibration stop.
start() {
  $A -s "$S" logcat -c
  $UI tap "$START" >/dev/null && wait_for 10 "the session" logged "session started"
}
case $2 in
  state) state ;;
  leave)
    start
    $A -s "$S" logcat -c
    sh input keyevent KEYCODE_HOME
    wait_for 60 "the way-back notification" logged "alarm screen left for"
    echo "after leaving:"; state; log
    ;;
  idle)
    start
    $A -s "$S" logcat -c
    started=$SECONDS
    wait_for 90 "full volume" logged "no answer for"
    echo "full volume $((SECONDS - started)) s after Start with no answer:"; state; log
    ;;
  answer)
    start
    started=$SECONDS
    wait_for 20 "the card" shows "$REVEAL" && $UI tap "$REVEAL" >/dev/null
    # The grades show after the session's grade delay.
    wait_for 20 "the grades" shows "$AGAIN" && $UI tap "$AGAIN" >/dev/null
    answered=$SECONDS
    $A -s "$S" logcat -c
    wait_for 90 "full volume" logged "no answer for"
    echo "full volume $((SECONDS - answered)) s after Again, $((SECONDS - started)) s after Start"
    echo "(the idle time counts from the answer when the first is the idle time):"; state; log
    ;;
  swipe-away)
    $A -s "$S" logcat -c
    sh input keyevent KEYCODE_APP_SWITCH
    wait_for 10 "Recents" recents
    # A fast swipe goes Home instead; while the card is in Overview the screen still counts as shown.
    sh input touchscreen swipe 540 1400 540 100 500
    wait_for 20 "the swipe-away" logged "task removed"
    wait_for 30 "the watchdog or a new service" logged "for the ring already playing|service took over ring"
    echo "after swipe-away:"; state; log
    ;;
  crash)
    $A -s "$S" logcat -c
    sh am crash $P
    wait_for 60 "the restarted service" logged "service took over ring|for the ring already playing"
    echo "after am crash:"; state; log
    ;;
  reboot)
    $A -s "$S" reboot
    $A -s "$S" wait-for-device
    wait_for 300 "boot" booted
    wait_for 120 "the ring after boot" logged "service took over ring|for the ring already playing"
    echo "after reboot:"; state; log
    ;;
esac
