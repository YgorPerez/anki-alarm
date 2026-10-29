import { writeFileSync } from "node:fs";
import { createFingerprintAsync } from "@expo/fingerprint";

writeFileSync(
  "../../fingerprint.json",
  JSON.stringify(
    await createFingerprintAsync(process.cwd(), {
      platforms: ["android"],
      // Match expo-updates' managed workflow before and after Expo prebuild.
      ignorePaths: ["android/**/*", "ios/**/*"],
    }),
  ),
);
