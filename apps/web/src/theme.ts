import {
  FACTORY_THEME,
  parseThemeChoice,
  themeChoiceOf,
  type Settings,
  themeFor,
  type Hex,
  type Theme,
  type ThemeChoice,
  type ThemeField,
} from "@app/core";
import { useQuery } from "@tanstack/react-query";
import { webData, webRequest } from "./data/client.ts";
import { queryClient } from "./query.ts";

// SQLite is the source of truth. localStorage caches only derived CSS for the first paint.
const CSS_KEY = "theme-css";
const STYLE_ID = "theme";
export const THEME_SCRIPT = `try{var c=localStorage.getItem("${CSS_KEY}");if(c){var s=document.createElement("style");s.id="${STYLE_ID}";s.textContent=c;document.head.appendChild(s)}}catch(e){}`;

const key = ["settings"];
const options = {
  queryKey: key,
  queryFn: async () => {
    const settings = await webRequest("settings");
    let legacy: string | null = null;
    try {
      legacy = localStorage.getItem("theme");
    } catch {
      /* Optional first-paint cache. */
    }
    if (!legacy) return settings;
    let patch: Partial<ThemeChoice>;
    try {
      patch = parseThemeChoice(JSON.parse(legacy));
    } catch {
      patch = {};
    }
    const migrated = await webRequest("setTheme", patch);
    try {
      localStorage.removeItem("theme");
    } catch {
      /* SQLite already committed. */
    }
    return migrated;
  },
};
export const useThemeChoice = () => {
  const result = useQuery(options, queryClient);
  return result.data ? themeChoiceOf(result.data) : FACTORY_THEME;
};
export const useStorageState = () => useQuery(options, queryClient);
const save = async (patch: Partial<ThemeChoice>) => {
  try {
    const settings = await webRequest("setTheme", patch);
    queryClient.setQueryData(key, settings);
    queryClient.setQueryData(["storage-error"], null);
    return settings;
  } catch (error) {
    // Expose write failures through the same visible storage status as startup failures.
    queryClient.setQueryData(["storage-error"], String(error));
    throw error;
  }
};
export const useStorageError = () =>
  useQuery(
    { queryKey: ["storage-error"], queryFn: () => null as string | null, staleTime: Infinity },
    queryClient,
  ).data;
export const setThemeField = (field: ThemeField, value: Hex | "primary") => {
  void save({ [field]: value }).catch(() => {});
};
export const resetTheme = () => {
  void save(FACTORY_THEME).catch(() => {});
};

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
  const settings = queryClient.getQueryData<Settings>(key);
  if (!settings) return;
  const choice = themeChoiceOf(settings);
  const css = choice === FACTORY_THEME ? "" : themeCss(choice);
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.append(style);
  }
  style.textContent = css;
  try {
    if (css) localStorage.setItem(CSS_KEY, css);
    else localStorage.removeItem(CSS_KEY);
  } catch {
    /* SQLite remains usable when localStorage is disabled. */
  }
};

/** For an effect in the root: keeps <html> in the user's theme. */
export const followTheme = () => {
  apply();
  const unsubscribe = queryClient.getQueryCache().subscribe(apply);
  window.addEventListener("pagehide", stop);
  window.addEventListener("pageshow", restore);
  return () => {
    unsubscribe();
    window.removeEventListener("pagehide", stop);
    window.removeEventListener("pageshow", restore);
  };
};

const stop = () => webData().close();
const restore = (event: PageTransitionEvent) => {
  if (event.persisted) window.location.reload();
};
