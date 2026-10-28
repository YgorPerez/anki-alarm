const { withAppBuildGradle } = require("expo/config-plugins");

// java.time is used before JS starts, including on Android 7 (Expo's minimum API 24).
/** @type {import("expo/config-plugins").ConfigPlugin} */
module.exports = function withAlarmNative(config) {
  return withAppBuildGradle(config, (mod) => {
    const marker = "// alarm-native java.time support";
    if (!mod.modResults.contents.includes(marker)) {
      mod.modResults.contents += `\n${marker}
android.compileOptions {
    coreLibraryDesugaringEnabled true
}
dependencies {
    coreLibraryDesugaring 'com.android.tools:desugar_jdk_libs:2.1.5'
}
`;
    }
    return mod;
  });
};
