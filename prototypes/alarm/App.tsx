// PROTOTYPE for #6 (a native alarm that can't be escaped). Throwaway: a test harness, not the app.
import { useEffect, useState } from 'react';
import { AppState, BackHandler, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Alarm, { type AlarmState, type Settings, type SettingsTarget } from './modules/alarm-native';

const N = 3;

export default function App() {
  const [state, setState] = useState<AlarmState>(() => Alarm.getState());
  const [log, setLog] = useState<string[]>(() => Alarm.getLog());

  const refresh = () => {
    setState(Alarm.getState());
    setLog(Alarm.getLog());
  };

  useEffect(() => {
    const timer = setInterval(refresh, 1000);
    const sub = AppState.addEventListener('change', refresh);
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => Alarm.getState().ringing);
    return () => sub.remove();
  }, []);

  return (
    <View style={s.root}>
      <StatusBar style={state.ringing ? 'light' : 'dark'} />
      <ScrollView contentContainerStyle={s.scroll}>
        {state.ringing ? <Ringing state={state} onChange={refresh} /> : <Controls state={state} onChange={refresh} />}
        <Log lines={log} onChange={refresh} />
      </ScrollView>
    </View>
  );
}

function Ringing({ state, onChange }: { state: AlarmState; onChange: () => void }) {
  const [revealed, setRevealed] = useState(false);
  const card = state.correct + 1;

  const grade = (good: boolean) => {
    const correct = Alarm.answer(good);
    setRevealed(false);
    if (correct >= N) Alarm.dismiss();
    onChange();
  };

  return (
    <View style={[s.card, s.ringing]}>
      <Text style={s.big}>RINGING</Text>
      <Text style={s.light}>
        {state.correct}/{N} right · service {state.serviceAlive ? 'alive' : 'DEAD'} · level{' '}
        {state.level == null ? '-' : Math.round(state.level * 100) + '%'}
      </Text>
      {!state.sessionStarted ? (
        <Button
          label="Start the session (drops the sound)"
          onPress={() => {
            Alarm.startSession();
            onChange();
          }}
        />
      ) : (
        <>
          <Text style={s.question}>
            Card {card}: {card} + {card} = ?
          </Text>
          {revealed ? (
            <>
              <Text style={s.question}>{card * 2}</Text>
              <View style={s.row}>
                <Button label="Again" onPress={() => grade(false)} />
                <Button label="Good" onPress={() => grade(true)} />
              </View>
            </>
          ) : (
            <Button label="Show answer" onPress={() => setRevealed(true)} />
          )}
        </>
      )}
      <Text style={s.light}>
        Try: Home, Recents swipe, screen off, power menu. Back is blocked. Coming back within {state.settings.leaveSeconds}s
        keeps it quiet; after that it goes full volume.
      </Text>
    </View>
  );
}

function Controls({ state, onChange }: { state: AlarmState; onChange: () => void }) {
  const p = state.permissions;
  const fix = (target: SettingsTarget) => () => Alarm.openSettings(target);
  const set = (key: keyof Settings, value: number) => () => {
    Alarm.setSetting(key, value);
    onChange();
  };
  const toggle = (key: keyof Settings) => set(key, state.settings[key] ? 0 : 1);

  return (
    <>
      <View style={s.card}>
        <Text style={s.h}>Device</Text>
        <Text>
          {state.device.manufacturer} {state.device.model} · Android {state.device.release} (API {state.device.sdk})
        </Text>
        <Text>
          Alarm stream {state.audio.alarmVolume}/{state.audio.alarmMax} · ringer mode {state.audio.ringerMode} (2 normal, 1
          vibrate, 0 silent) · DND filter {state.audio.interruptionFilter} (1 off, 2 priority, 3 none, 4 alarms)
        </Text>
      </View>

      <View style={s.card}>
        <Text style={s.h}>Permissions</Text>
        <Perm label="Exact alarms" ok={p.exactAlarm} onFix={fix('exactAlarm')} />
        <Perm label="Full-screen intent" ok={p.fullScreenIntent} onFix={fix('fullScreenIntent')} />
        <Perm label="Notifications" ok={p.notifications} onFix={() => Alarm.requestNotifications()} />
        <Perm label="Display over other apps (optional)" ok={p.overlay} onFix={fix('overlay')} />
        <Perm label="Unrestricted battery (optional)" ok={p.ignoringBatteryOptimizations} onFix={fix('battery')} />
        <Button label="App settings" onPress={fix('app')} />
      </View>

      <View style={s.card}>
        <Text style={s.h}>Alarms</Text>
        <View style={s.row}>
          {[15, 60, 300, 1800].map((sec) => (
            <Button
              key={sec}
              label={sec < 60 ? `${sec} s` : `${sec / 60} min`}
              onPress={() => {
                Alarm.schedule(sec);
                onChange();
              }}
            />
          ))}
          <Button label="Ring now" onPress={() => Alarm.ringNow()} />
        </View>
        {state.alarms.map((a) => (
          <View key={a.id} style={s.row}>
            <Text style={s.grow}>
              #{a.id} at {new Date(a.at).toLocaleTimeString()}
            </Text>
            <Button
              label="Cancel"
              onPress={() => {
                Alarm.cancel(a.id);
                onChange();
              }}
            />
          </View>
        ))}
        <Text>
          System's next alarm clock (any app):{' '}
          {state.nextSystemAlarm ? new Date(state.nextSystemAlarm).toLocaleTimeString() : 'none'}
        </Text>
      </View>

      <View style={s.card}>
        <Text style={s.h}>Settings</Text>
        <View style={s.row}>
          <Text style={s.grow}>Ramp {state.settings.rampSeconds}s</Text>
          {[5, 30, 60].map((v) => (
            <Button key={v} label={`${v}s`} onPress={set('rampSeconds', v)} />
          ))}
        </View>
        <View style={s.row}>
          <Text style={s.grow}>Full volume after no answer for {state.settings.idleSeconds}s</Text>
          {[10, 20, 60].map((v) => (
            <Button key={v} label={`${v}s`} onPress={set('idleSeconds', v)} />
          ))}
        </View>
        <Setting label="Vibrate" on={!!state.settings.vibrate} onPress={toggle('vibrate')} />
        <Setting label="Raise alarm stream to max while ringing" on={!!state.settings.forceMaxVolume} onPress={toggle('forceMaxVolume')} />
        <Setting label="Also startActivity from the service" on={!!state.settings.directLaunch} onPress={toggle('directLaunch')} />
      </View>
    </>
  );
}

function Log({ lines, onChange }: { lines: string[]; onChange: () => void }) {
  return (
    <View style={s.card}>
      <View style={s.row}>
        <Text style={[s.h, s.grow]}>Log (newest first, survives kills)</Text>
        <Button label="Share" onPress={() => Share.share({ message: [...lines].reverse().join('\n') })} />
        <Button
          label="Clear"
          onPress={() => {
            Alarm.clearLog();
            onChange();
          }}
        />
      </View>
      {lines.slice(0, 150).map((line, i) => (
        <Text key={i} style={s.mono}>
          {line}
        </Text>
      ))}
    </View>
  );
}

function Perm({ label, ok, onFix }: { label: string; ok: boolean; onFix: () => void }) {
  return (
    <View style={s.row}>
      <Text style={s.grow}>
        {ok ? '✅' : '❌'} {label}
      </Text>
      {!ok && <Button label="Fix" onPress={onFix} />}
    </View>
  );
}

function Setting({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <View style={s.row}>
      <Text style={s.grow}>{label}</Text>
      <Button label={on ? 'ON' : 'off'} onPress={onPress} />
    </View>
  );
}

function Button({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.button, pressed && { opacity: 0.6 }]}>
      <Text style={s.buttonText}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f2f2f2', paddingTop: 48 },
  scroll: { padding: 12, gap: 12 },
  card: { backgroundColor: 'white', borderRadius: 12, padding: 12, gap: 8 },
  ringing: { backgroundColor: '#b3261e', paddingVertical: 32 },
  big: { fontSize: 40, fontWeight: '800', color: 'white', textAlign: 'center' },
  question: { fontSize: 32, color: 'white', textAlign: 'center' },
  light: { color: 'white' },
  h: { fontSize: 18, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  grow: { flex: 1 },
  button: { backgroundColor: '#222', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 },
  buttonText: { color: 'white', fontWeight: '600' },
  mono: { fontFamily: 'monospace', fontSize: 11 },
});
