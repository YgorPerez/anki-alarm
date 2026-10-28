import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createMMKV } from "react-native-mmkv";
import type { Locale } from "@app/core";
const storage = createMMKV({ id: "ui" });
/** Device-only UI preferences. Synced settings live in SQLite. */
export const useUI = create(
  persist<{ locale: Locale; setLocale: (locale: Locale) => void }>(
    (set) => ({
      locale: "pt-BR",
      setLocale: (locale) => set({ locale }),
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
