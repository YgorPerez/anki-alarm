import {
  FACTORY_THEME,
  parseThemeChoice,
  themeFor,
  type Hex,
  type ThemeChoice,
  type ThemeField,
} from "@app/core";
import { useSyncExternalStore } from "react";
import { Uniwind } from "uniwind";

// The user's theme. It lives in memory until the phone has its database (#38), and becomes a
// synced setting with sync (#52).
let current = FACTORY_THEME;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * Lays the derived theme over tokens.css in both modes. The alarm screen, always dark, reads the
 * dark one through `<ScopedTheme theme="dark">`.
 */
const setTheme = (choice: ThemeChoice) => {
  current = choice;
  for (const mode of ["light", "dark"] as const) {
    const theme = Object.entries(themeFor(choice, mode));
    Uniwind.updateCSSVariables(
      mode,
      Object.fromEntries(theme.map(([name, value]) => [`--color-${name}`, value])),
    );
  }
  for (const listener of listeners) listener();
};

export const useThemeChoice = () => useSyncExternalStore(subscribe, () => current);

export const setThemeField = (field: ThemeField, value: Hex | "primary") =>
  setTheme(parseThemeChoice({ ...current, [field]: value }));

export const resetTheme = () => setTheme(FACTORY_THEME);
