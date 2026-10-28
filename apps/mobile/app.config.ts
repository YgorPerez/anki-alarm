import type { ExpoConfig } from "expo/config";

// The name is not decided (docs/spec.md); "anki-alarm" is the working one until the first release.
const config: ExpoConfig = {
  name: "Despertador",
  slug: "anki-alarm",
  scheme: "anki-alarm",
  version: "0.0.0",
  platforms: ["android"],
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  android: {
    package: "dev.ygorperez.ankialarm",
  },
  plugins: ["expo-dev-client", "./plugins/with-alarm-native.js"],
};

export default config;
