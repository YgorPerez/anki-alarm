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
}
export function reliabilitySteps(p: AlarmPermissions): ReliabilityStep[] {
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
  return kinds.map((kind) => ({
    kind,
    state:
      kind === "recents" || kind === "neverSleeping" || kind === "motorolaBattery"
        ? "unknown"
        : (p[kind] ?? "unknown"),
    restrictedSettings:
      kind === "overlay" &&
      p.overlay !== "granted" &&
      p.sdk >= 35 &&
      (p.installSource === "local" || p.installSource === "downloaded"),
  }));
}
