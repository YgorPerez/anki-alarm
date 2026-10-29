import {
  FACTORY_THEME,
  nativeAppearance,
  themeChoiceOf,
  themeFor,
  type Hex,
  type ThemeChoice,
  type ThemeField,
} from "@app/core";
import { useQuery } from "@tanstack/react-query";
import { Effect } from "effect";
import { localData } from "./database.ts";
import { queryClient } from "./query.ts";
import { requireNativeModule } from "expo";
import { Uniwind } from "uniwind";

const appearance = requireNativeModule<{
  save: (choice: string, light: number, dark: number) => void;
  queueIcon: (primary: number, secondary: number) => void;
}>("ThemeAppearance");

const options = {
  queryKey: ["settings"],
  queryFn: () => Effect.runPromise(localData((data) => data.settings)),
};
export const initializeTheme = async () => {
  setTheme(themeChoiceOf(await queryClient.fetchQuery(options)));
};
/**
 * Lays the derived theme over tokens.css in both modes. The alarm screen, always dark, reads the
 * dark one through `<ScopedTheme theme="dark">`.
 */
const setTheme = (choice: ThemeChoice) => {
  const { light, dark } = nativeAppearance(choice);
  appearance.save(JSON.stringify(choice), light, dark);
  for (const mode of ["light", "dark"] as const) {
    const theme = Object.entries(themeFor(choice, mode));
    Uniwind.updateCSSVariables(
      mode,
      Object.fromEntries(theme.map(([name, value]) => [`--color-${name}`, value])),
    );
  }
};

export const useThemeChoice = () => {
  const query = useQuery(options);
  return query.data ? themeChoiceOf(query.data) : FACTORY_THEME;
};
const persistTheme = async (patch: Partial<ThemeChoice>) => {
  const settings = await Effect.runPromise(localData((data) => data.setTheme(patch)));
  queryClient.setQueryData(options.queryKey, settings);
  setTheme(themeChoiceOf(settings));
};
export const setThemeField = (field: ThemeField, value: Hex | "primary") =>
  persistTheme({ [field]: value });
export const resetTheme = () => persistTheme(FACTORY_THEME);

/** Called only after the launcher shortcut warning has been accepted. */
export const queueThemeIcon = async () => {
  const choice = themeChoiceOf(await queryClient.fetchQuery(options));
  const { primary, secondary } = nativeAppearance(choice);
  appearance.queueIcon(primary, secondary);
};
