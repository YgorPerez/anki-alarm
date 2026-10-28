import { requireNativeModule } from 'expo';

export type Settings = {
  rampSeconds: number;
  leaveSeconds: number;
  idleSeconds: number;
  lowLevel: number; // percent of full while answering
  vibrate: number; // 0 | 1
  forceMaxVolume: number; // 0 | 1: raise the alarm stream to max while ringing
  silent: number; // 0 | 1: play at volume 0 (phone test runs)
  directLaunch: number; // 0 | 1: also try startActivity from the service
};

export type AlarmState = {
  ringing: boolean;
  correct: number;
  ringStartedAt: number;
  serviceAlive: boolean;
  screenVisible: boolean;
  sessionStarted: boolean | null;
  level: number | null;
  alarms: { id: number; at: number }[];
  nextSystemAlarm: number | null;
  oem: Oem;
  permissions: {
    exactAlarm: boolean;
    fullScreenIntent: boolean;
    notifications: boolean;
    overlay: boolean;
    ignoringBatteryOptimizations: boolean;
  };
  settings: Settings;
  audio: { alarmVolume: number; alarmMax: number; ringerMode: number; interruptionFilter: number };
  device: { manufacturer: string; model: string; release: string; sdk: number };
};

// #35: each check is "granted", "denied", "default" or "unknown (why)". The miui* ones are null off Xiaomi.
export type Oem = {
  brand: string;
  miuiVersion?: string | null;
  hyperOsVersion?: string | null;
  oneUiVersion?: string | null;
  installSource: string;
  restrictedSettings: string;
  backgroundRestricted: boolean;
  standbyBucket: string;
  miuiAutostart?: string | null;
  miuiAutostartReflect?: string | null;
  miuiShowWhenLocked?: string | null;
  miuiBackgroundStart?: string | null;
  miuiNoRestrictions?: string | null;
};

export type OemTarget = 'miuiAutostart' | 'miuiPermissions' | 'miuiBatterySaver' | 'samsungNeverSleeping' | 'oemAutostart';

export type SettingsTarget = 'exactAlarm' | 'fullScreenIntent' | 'overlay' | 'battery' | 'app';

type AlarmNativeModule = {
  getState(): AlarmState;
  getLog(): string[];
  clearLog(): void;
  schedule(seconds: number): number;
  cancel(id: number): void;
  ringNow(): void;
  startSession(): void;
  answer(good: boolean): number;
  dismiss(): void;
  setSetting(key: keyof Settings, value: number): void;
  requestNotifications(): void;
  openSettings(target: SettingsTarget): void;
  openOemSettings(target: OemTarget): boolean;
  logOem(): void;
};

export default requireNativeModule<AlarmNativeModule>('AlarmNative');
