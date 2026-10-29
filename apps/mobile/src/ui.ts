import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createMMKV } from "react-native-mmkv";
import type { Locale, ReliabilityKind } from "@app/core";
const storage = createMMKV({ id: "ui" });
/** Device-only UI preferences. Synced settings live in SQLite. */
export const useUI = create(
  persist<{
    locale: Locale;
    setLocale: (locale: Locale) => void;
    /** Reliability settings the app can't read that the user marked as done. */
    confirmedSettings: ReliabilityKind[];
    confirmSetting: (kind: ReliabilityKind, done: boolean) => void;
    /** The alarm saved last on this phone: a new alarm starts with its deck and N. */
    lastSavedAlarm: string | null;
    setLastSavedAlarm: (alarmId: string) => void;
  }>(
    (set) => ({
      locale: "pt-BR",
      setLocale: (locale) => set({ locale }),
      confirmedSettings: [],
      confirmSetting: (kind, done) =>
        set(({ confirmedSettings }) => ({
          confirmedSettings: done
            ? [...new Set([...confirmedSettings, kind])]
            : confirmedSettings.filter((k) => k !== kind),
        })),
      lastSavedAlarm: null,
      setLastSavedAlarm: (lastSavedAlarm) => set({ lastSavedAlarm }),
    }),
    {
      name: "preferences",
      storage: createJSONStorage(() => ({
        getItem: (key) => storage.getString(key) ?? null,
        setItem: (key, value) => {
          storage.set(key, value);
        },
        removeItem: (key) => {
          storage.remove(key);
        },
      })),
    },
  ),
);
