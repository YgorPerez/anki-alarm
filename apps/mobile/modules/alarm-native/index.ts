import { requireNativeModule } from "expo";

interface NativeAlarm {
  createId: () => string;
  setAlarms: (alarms: string, policy: string) => void;
  setAppearance: (colors: string, locale: string) => void;
  list: () => string;
  getRing: () => string | null;
  drainJournal: () => string;
  ack: (ids: readonly string[]) => void;
  dismiss: (ringId: string) => void;
  getPermissions: () => Record<string, boolean>;
  request: (kind: string) => void;
  addListener: (event: "onChange", listener: () => void) => { remove: () => void };
}
export default requireNativeModule<NativeAlarm>("AlarmNative");
