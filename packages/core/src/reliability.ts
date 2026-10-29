export type PermissionState = "granted" | "denied" | "unknown";
export type ReliabilityKind =
  | "notifications"
  | "overlay"
  | "exactAlarm"
  | "fullScreenIntent"
  | "battery"
  | "backgroundRestricted"
  | "autostart"
  | "lockScreen"
  | "backgroundPopups"
  | "noRestrictions"
  | "recents"
  | "neverSleeping"
  | "motorolaBattery";
export interface AlarmPermissions {
  manufacturer: string;
  sdk: number;
  installSource: "local" | "downloaded" | "store" | "unknown";
  standbyBucket: number | null;
  notifications: PermissionState;
  overlay: PermissionState;
  exactAlarm: PermissionState;
  fullScreenIntent: PermissionState;
  battery: PermissionState;
  /** Granted means background work is allowed (isBackgroundRestricted is false). */
  backgroundRestricted: PermissionState;
  autostart?: PermissionState;
  lockScreen?: PermissionState;
  backgroundPopups?: PermissionState;
  noRestrictions?: PermissionState;
}
export interface ReliabilityStep {
  kind: ReliabilityKind;
  state: PermissionState;
  restrictedSettings: boolean;
  /** The app can't read this setting and the user said it's done. */
  confirmed: boolean;
  /** Granted, or confirmed by the user. */
  settled: boolean;
  /** A tap can take the user to it. Recents is set from the Recents screen, not a settings page. */
  openable: boolean;
}
function reliabilitySteps(
  p: AlarmPermissions,
  confirmed: ReadonlySet<ReliabilityKind>,
): ReliabilityStep[] {
  const kinds: ReliabilityKind[] = [
    "notifications",
    "overlay",
    "fullScreenIntent",
    "exactAlarm",
    "battery",
    "backgroundRestricted",
  ];
  const brand = p.manufacturer.toLowerCase();
  if (["xiaomi", "redmi", "poco"].includes(brand))
    kinds.push("autostart", "lockScreen", "backgroundPopups", "noRestrictions", "recents");
  else if (brand === "samsung") kinds.push("neverSleeping");
  else if (brand === "motorola") kinds.push("motorolaBattery");
  else if (["oneplus", "oppo", "realme", "vivo"].includes(brand)) {
    kinds.push("autostart");
    if (["realme", "vivo"].includes(brand)) kinds.push("backgroundPopups");
    kinds.push("recents");
  }
  return kinds.map((kind) => {
    const state =
      kind === "recents" || kind === "neverSleeping" || kind === "motorolaBattery"
        ? "unknown"
        : (p[kind] ?? "unknown");
    const done = state === "unknown" && confirmed.has(kind);
    return {
      kind,
      state,
      restrictedSettings:
        kind === "overlay" &&
        p.overlay !== "granted" &&
        p.sdk >= 35 &&
        (p.installSource === "local" || p.installSource === "downloaded"),
      confirmed: done,
      settled: state === "granted" || done,
      openable: state !== "granted" && kind !== "recents",
    };
  });
}

const essential: ReadonlySet<ReliabilityKind> = new Set([
  "notifications",
  "overlay",
  "fullScreenIntent",
  "exactAlarm",
]);
export interface ReliabilityChecklist {
  /** The settings an alarm can't ring or show without. */
  essentials: ReliabilityStep[];
  /** Battery and manufacturer settings: they help, and never block. */
  recommended: ReliabilityStep[];
  /** Every essential is granted: onboarding can finish and Home needs no warning. */
  ready: boolean;
}
export function reliabilityChecklist(
  p: AlarmPermissions,
  confirmed: ReadonlySet<ReliabilityKind>,
): ReliabilityChecklist {
  const steps = reliabilitySteps(p, confirmed);
  const essentials = steps.filter((step) => essential.has(step.kind));
  return {
    essentials,
    recommended: steps.filter((step) => !essential.has(step.kind)),
    ready: essentials.every((step) => step.settled),
  };
}
