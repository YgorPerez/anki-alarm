import { describe, expect, it } from "vite-plus/test";
import { reliabilityChecklist, type AlarmPermissions } from "./index.ts";

const stock: AlarmPermissions = {
  manufacturer: "Google",
  sdk: 35,
  installSource: "local",
  notifications: "denied",
  overlay: "denied",
  exactAlarm: "granted",
  fullScreenIntent: "granted",
  battery: "denied",
  backgroundRestricted: "granted",
  standbyBucket: 10,
};
const none = new Set<never>();
const kinds = (steps: { kind: string }[]) => steps.map((s) => s.kind);

describe("the reliability checklist", () => {
  it("puts the four settings an alarm can't ring without first, and battery after them", () => {
    const list = reliabilityChecklist(stock, none);
    expect(kinds(list.essentials)).toEqual([
      "notifications",
      "overlay",
      "fullScreenIntent",
      "exactAlarm",
    ]);
    expect(kinds(list.recommended)).toEqual(["battery", "backgroundRestricted"]);
  });
});

const overlay = (p: AlarmPermissions) =>
  reliabilityChecklist(p, none).essentials.find((s) => s.kind === "overlay");
it("explains restricted settings for sideloads on Android 15 only while overlay is missing", () => {
  expect(overlay(stock)?.restrictedSettings).toBe(true);
  expect(overlay({ ...stock, overlay: "granted" })?.restrictedSettings).toBe(false);
  expect(overlay({ ...stock, sdk: 34 })?.restrictedSettings).toBe(false);
  expect(overlay({ ...stock, installSource: "store" })?.restrictedSettings).toBe(false);
});

const recommended = (manufacturer: string, p: Partial<AlarmPermissions> = {}) =>
  reliabilityChecklist({ ...stock, ...p, manufacturer }, none).recommended;
it("recommends the brand's settings without claiming unreadable ones are granted", () => {
  expect(recommended("POCO").map((s) => [s.kind, s.state])).toEqual([
    ["battery", "denied"],
    ["backgroundRestricted", "granted"],
    ["autostart", "unknown"],
    ["lockScreen", "unknown"],
    ["backgroundPopups", "unknown"],
    ["noRestrictions", "unknown"],
    ["recents", "unknown"],
  ]);
  expect(recommended("SAMSUNG").at(-1)).toMatchObject({ kind: "neverSleeping", state: "unknown" });
  expect(recommended("Motorola").at(-1)?.kind).toBe("motorolaBattery");
  for (const manufacturer of ["OnePlus", "OPPO", "realme", "vivo"])
    expect(kinds(recommended(manufacturer))).toContain("autostart");
  const xiaomi = recommended("Xiaomi", { lockScreen: "denied", backgroundPopups: "granted" });
  expect(xiaomi.find((s) => s.kind === "lockScreen")?.state).toBe("denied");
  expect(xiaomi.find((s) => s.kind === "backgroundPopups")?.state).toBe("granted");
});

it("is ready once every essential is granted, whatever the battery and brand settings say", () => {
  expect(reliabilityChecklist(stock, none).ready).toBe(false);
  const granted = { ...stock, notifications: "granted", overlay: "granted" } as const;
  expect(reliabilityChecklist({ ...granted, manufacturer: "Xiaomi" }, none).ready).toBe(true);
});

it("takes the user's word only for settings the app can't read", () => {
  const unreadable = { ...stock, notifications: "granted", overlay: "unknown" } as const;
  const list = reliabilityChecklist(
    { ...unreadable, manufacturer: "Samsung" },
    new Set(["overlay", "neverSleeping", "battery"]),
  );
  expect(list.ready).toBe(true);
  expect(list.recommended.map((s) => [s.kind, s.confirmed])).toEqual([
    ["battery", false],
    ["backgroundRestricted", false],
    ["neverSleeping", true],
  ]);
});
