import type { ExpoConfig } from "expo/config";

import { THEME_SWATCHES } from "../../packages/core/src/theme.ts";

import { releaseVersion } from "../../packages/core/src/release.ts";

const tag = process.env["RELEASE_TAG"];
const release = tag ? releaseVersion(tag) : { version: "0.0.0", versionCode: 1 };
const projectId = process.env["EXPO_PUBLIC_EAS_PROJECT_ID"];

// The name is not decided (docs/spec.md); "anki-alarm" is the working one until the first release.
const config: ExpoConfig = {
  name: "Despertador",
  slug: "anki-alarm",
  scheme: "anki-alarm",
  version: release.version,
  platforms: ["android"],
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  android: {
    versionCode: release.versionCode,
    permissions: ["android.permission.REQUEST_INSTALL_PACKAGES"],
    package: "dev.ygorperez.ankialarm",
  },
  runtimeVersion: { policy: "fingerprint" },
  updates: {
    enabled: Boolean(projectId),
    ...(projectId ? { url: `https://u.expo.dev/${projectId}` } : {}),
    checkAutomatically: "ON_LOAD",
    fallbackToCacheTimeout: 0,
    requestHeaders: { "expo-channel-name": "production" },
  },
  extra: { eas: { projectId } },
  plugins: [
    "expo-dev-client",
    "expo-sqlite",
    "expo-font",
    "./plugins/with-alarm-native.js",
    ["./plugins/with-theme-appearance.js", { swatches: THEME_SWATCHES }],
  ],
};

export default config;
