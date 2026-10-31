import type { AlarmPermissions, ReliabilityKind } from "@app/core";
import { requireNativeModule } from "expo";

interface NativeAlarm {
  pickSound: (kind: "ringtone" | "file", currentUri: string | null) => Promise<string | null>;
  previewSound: (sound: string) => void;
  stopPreview: () => void;
  is24HourFormat: () => boolean;
  createId: () => string;
  setAlarms: (alarms: string, policy: string) => void;
  setAppearance: (colors: string, locale: string) => void;
  list: () => string;
  getRing: () => string | null;
  drainJournal: () => string;
  ack: (ids: readonly string[]) => void;
  sessionStarted: (ringId: string) => void;
  activity: (ringId: string) => void;
  /** Returns the ring's JSON after snoozing, or null when no ring is active. */
  snooze: (ringId: string, minutes: number) => string | null;
  dismiss: (ringId: string, awakeCheckAfter: number | null) => void;
  getAwakeCheck: () => string | null;
  awakeCheckActivity: (checkId: string) => boolean;
  awakeCheckPassed: (checkId: string) => boolean;
  /** Resolves when the speech ends or is stopped. */
  speak: (text: string, language: string) => Promise<void>;
  /** Resolves when the clip ends or is stopped: false when it couldn't play. */
  playClip: (uri: string) => Promise<boolean>;
  stopReading: () => void;
  /** Another app's next alarm. Null when there's none, or ours is sooner. `app` is null if hidden. */
  otherNextAlarm: () => { at: number; app: string | null; icon: string | null } | null;
  openOtherAlarm: () => boolean;
  getPermissions: () => AlarmPermissions;
  isOnboardingComplete: () => boolean;
  completeOnboarding: () => boolean;
  request: (kind: ReliabilityKind | "appInfo") => boolean;
  addListener: (event: "onChange", listener: () => void) => { remove: () => void };
}
export default requireNativeModule<NativeAlarm>("AlarmNative");
