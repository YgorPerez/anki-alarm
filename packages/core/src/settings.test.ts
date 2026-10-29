import { expect, test } from "vite-plus/test";
import { FACTORY_THEME, themeChoiceOf, updateThemeSettings } from "./index.ts";

test("changing a color retains other clocks and advances after a backwards clock and restart", () => {
  const env = { deviceId: "phone", now: () => 1000, random: () => new Uint8Array(16) };
  const first = updateThemeSettings(undefined, { primary: "#7fd4ff" }, env);
  expect(first.id).toMatch(/^[0-9a-f-]{14}7[0-9a-f-]{21}$/);
  const next = updateThemeSettings(first, { secondary: "#ffd166" }, { ...env, now: () => 10 });
  expect(next.fields.primary).toEqual(first.fields.primary);
  expect(next.fields.secondary).toEqual({
    value: "#ffd166",
    hlc: { wallMs: 1000, counter: 1, deviceId: "phone" },
  });
  expect(updateThemeSettings(next, { primary: "#7fd4ff" }, env)).toEqual(next);
});

test("the theme choice a settings record holds, read as Core reads any choice", () => {
  const env = { deviceId: "phone", now: () => 1000, random: () => new Uint8Array(16) };
  const settings = updateThemeSettings(undefined, { primary: "#7fd4ff" }, env);
  expect(themeChoiceOf(settings)).toEqual({ ...FACTORY_THEME, primary: "#7fd4ff" });
  // A synced field this version can't read falls back to the factory theme's.
  Object.assign(settings.fields.primary, { value: "blue" });
  expect(themeChoiceOf(settings).primary).toBe(FACTORY_THEME.primary);
});
