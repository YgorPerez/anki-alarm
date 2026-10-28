import {
  FACTORY_THEME,
  nativeAppearance,
  parseThemeChoice,
  themeFor,
  type Hex,
  type ThemeChoice,
  type ThemeField,
} from "@app/core";
import { requireNativeModule } from "expo";
import { useSyncExternalStore } from "react";
import { Uniwind } from "uniwind";

const appearance = requireNativeModule<{
  getChoice: () => string | null;
  save: (choice: string, light: number, dark: number) => void;
  queueIcon: (primary: number, secondary: number) => void;
}>("ThemeAppearance");

// Local launch cache; #52 will replace this with the synced settings record as the source.
const readChoice = (): ThemeChoice => {
  try {
    return parseThemeChoice(JSON.parse(appearance.getChoice() ?? "null"));
  } catch {
    return FACTORY_THEME;
  }
};
let current = readChoice();
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
  const { light, dark } = nativeAppearance(choice);
  appearance.save(JSON.stringify(choice), light, dark);
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

/** Called only after the launcher shortcut warning has been accepted. */
export const queueThemeIcon = () => {
  const { primary, secondary } = nativeAppearance(current);
  appearance.queueIcon(primary, secondary);
};

setTheme(current);
