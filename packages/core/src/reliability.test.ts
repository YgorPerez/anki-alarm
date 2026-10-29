import { describe, expect, it } from "vite-plus/test";
import { reliabilitySteps, type AlarmPermissions } from "./index.ts";

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
describe("alarm setup", () => {
  it("starts with notifications and overlay, explaining restricted settings for sideloads only while overlay is missing", () => {
    const steps = reliabilitySteps(stock);
    expect(steps.slice(0, 2).map((s) => s.kind)).toEqual(["notifications", "overlay"]);
    expect(steps[1]?.restrictedSettings).toBe(true);
    expect(reliabilitySteps({ ...stock, overlay: "granted" })[1]?.restrictedSettings).toBe(false);
    expect(reliabilitySteps({ ...stock, sdk: 34 })[1]?.restrictedSettings).toBe(false);
    expect(reliabilitySteps({ ...stock, installSource: "store" })[1]?.restrictedSettings).toBe(
      false,
    );
  });
});

it("shows brand instructions without claiming unreadable OEM settings are granted", () => {
  expect(
    reliabilitySteps({ ...stock, manufacturer: "POCO" })
      .slice(6)
      .map((s) => [s.kind, s.state]),
  ).toEqual([
    ["autostart", "unknown"],
    ["lockScreen", "unknown"],
    ["backgroundPopups", "unknown"],
    ["noRestrictions", "unknown"],
    ["recents", "unknown"],
  ]);
  expect(reliabilitySteps({ ...stock, manufacturer: "SAMSUNG" }).at(-1)).toMatchObject({
    kind: "neverSleeping",
    state: "unknown",
  });
  expect(reliabilitySteps({ ...stock, manufacturer: "Motorola" }).at(-1)?.kind).toBe(
    "motorolaBattery",
  );
  for (const manufacturer of ["OnePlus", "OPPO", "realme", "vivo"]) {
    expect(reliabilitySteps({ ...stock, manufacturer }).some((s) => s.kind === "autostart")).toBe(
      true,
    );
  }
});
it("keeps denied OEM permissions visible and preserves unknown checks", () => {
  const steps = reliabilitySteps({
    ...stock,
    manufacturer: "Xiaomi",
    lockScreen: "denied",
    backgroundPopups: "granted",
  });
  expect(steps.find((s) => s.kind === "lockScreen")?.state).toBe("denied");
  expect(steps.find((s) => s.kind === "backgroundPopups")?.state).toBe("granted");
  expect(steps.find((s) => s.kind === "autostart")?.state).toBe("unknown");
});
