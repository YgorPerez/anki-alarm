import {
  FACTORY_THEME,
  parseThemeChoice,
  themeFor,
  type Hex,
  type Theme,
  type ThemeChoice,
  type ThemeField,
} from "@app/core";
import { useSyncExternalStore } from "react";

// The user's theme, in localStorage until the account setting (#52) replaces it. Core derives
// the tokens; a <style id="theme"> on <html> lays them over tokens.css.
const KEY = "theme";
/** The last derived CSS, so the next page load paints in the theme before the app starts. */
const CSS_KEY = "theme-css";
const STYLE_ID = "theme";

/** Runs in <head> before the first paint: the theme from the last visit. */
export const THEME_SCRIPT = `try{var c=localStorage.getItem("${CSS_KEY}");if(c){var s=document.createElement("style");s.id="${STYLE_ID}";s.textContent=c;document.head.appendChild(s)}}catch(e){}`;

let cache: { raw: string | null; choice: ThemeChoice } = { raw: null, choice: FACTORY_THEME };

const parse = (raw: string) => {
  try {
    return parseThemeChoice(JSON.parse(raw));
  } catch {
    return FACTORY_THEME;
  }
};

const snapshot = () => {
  const raw = localStorage.getItem(KEY);
  if (raw !== cache.raw) cache = { raw, choice: raw === null ? FACTORY_THEME : parse(raw) };
  return cache.choice;
};

const listeners = new Set<() => void>();

/** Changes from this tab and from the others. */
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
};

const save = (choice: ThemeChoice | undefined) => {
  if (choice) localStorage.setItem(KEY, JSON.stringify(choice));
  else localStorage.removeItem(KEY);
  for (const listener of listeners) listener();
};

export const useThemeChoice = () => useSyncExternalStore(subscribe, snapshot, () => FACTORY_THEME);

export const setThemeField = (field: ThemeField, value: Hex | "primary") =>
  save(parseThemeChoice({ ...snapshot(), [field]: value }));

export const resetTheme = () => save(undefined);

const block = (selector: string, theme: Theme) =>
  `${selector}{${Object.entries(theme)
    .map(([name, value]) => `--color-${name}:${value}`)
    .join(";")}}`;

/** The same variants as web.css: a .light/.dark class wins, otherwise the OS setting. */
const themeCss = (choice: ThemeChoice) => {
  const [light, dark] = [themeFor(choice, "light"), themeFor(choice, "dark")];
  return [
    block(":root", light),
    `@media (prefers-color-scheme: dark){${block(":root", dark)}}`,
    block(".light", light),
    block(".dark", dark),
  ].join("\n");
};

const apply = () => {
  const choice = snapshot();
  const css = choice === FACTORY_THEME ? "" : themeCss(choice);
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.append(style);
  }
  style.textContent = css;
  if (css) localStorage.setItem(CSS_KEY, css);
  else localStorage.removeItem(CSS_KEY);
};

/** For an effect in the root: keeps <html> in the user's theme. */
export const followTheme = () => {
  apply();
  return subscribe(apply);
};
