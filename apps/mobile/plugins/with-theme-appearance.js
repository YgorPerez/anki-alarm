const { withAndroidManifest, withDangerousMod, withMainActivity } = require("expo/config-plugins");
const { mkdir, writeFile } = require("node:fs/promises");
const path = require("node:path");

/** Generates native resources from Core's swatches, passed by app.config.ts. */
module.exports = function withThemeAppearance(config, { swatches }) {
  config = withAndroidManifest(config, (mod) => {
    const app = mod.modResults.manifest.application[0];
    const main = app.activity.find((a) => a.$["android:name"] === ".MainActivity");
    main["intent-filter"] = main["intent-filter"].filter(
      (filter) =>
        !filter.category?.some((c) => c.$["android:name"] === "android.intent.category.LAUNCHER"),
    );
    app.$["android:icon"] = "@mipmap/theme_icon_0_0";
    app.$["android:roundIcon"] = "@mipmap/theme_icon_0_0";
    const otherAliases = (app["activity-alias"] ?? []).filter(
      (alias) => !alias.$["android:name"].startsWith(".ThemeIcon_"),
    );
    app["activity-alias"] = otherAliases.concat(
      Array.from({ length: swatches.primary.length }, (_, p) =>
        swatches.secondary.map((_secondary, s) => ({
          $: {
            "android:name": `.ThemeIcon_${p}_${s}`,
            "android:targetActivity": ".MainActivity",
            "android:enabled": p === 0 && s === 0 ? "true" : "false",
            "android:exported": "true",
            "android:icon": `@mipmap/theme_icon_${p}_${s}`,
            "android:roundIcon": `@mipmap/theme_icon_${p}_${s}`,
            "android:label": "@string/app_name",
          },
          "intent-filter": [
            {
              action: [{ $: { "android:name": "android.intent.action.MAIN" } }],
              category: [{ $: { "android:name": "android.intent.category.LAUNCHER" } }],
            },
          ],
        })),
      ).flat(),
    );
    return mod;
  });
  config = withMainActivity(config, (mod) => {
    const marker = "// Apply an approved icon only after this screen leaves.";
    if (!mod.modResults.contents.includes(marker)) {
      mod.modResults.contents = mod.modResults.contents.replace(
        /\n}\s*$/,
        `\n  ${marker}\n  override fun onStop() {\n    super.onStop()\n    if (!isChangingConfigurations) {\n      runCatching { expo.modules.alarmnative.ThemeAppearance.applyPending(this) }\n        .onFailure { android.util.Log.e("ThemeAppearance", "Icon switch failed; will retry", it) }\n    }\n  }\n}\n`,
      );
    }
    return mod;
  });
  return withDangerousMod(config, [
    "android",
    async (mod) => {
      const res = path.join(mod.modRequest.platformProjectRoot, "app/src/main/res");
      const write = async (dir, file, xml) => {
        await mkdir(path.join(res, dir), { recursive: true });
        await writeFile(path.join(res, dir, file), xml);
      };
      const writes = [];
      for (const [p, primary] of swatches.primary.entries()) {
        for (const [s, secondary] of swatches.secondary.entries()) {
          const name = `theme_icon_${p}_${s}`;
          // A card and clock share one silhouette. All artwork stays inside the adaptive safe area.
          const vector = `<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">
<path android:fillColor="${primary}" android:pathData="M32,28 L70,28 Q76,28 76,34 L76,74 Q76,80 70,80 L32,80 Q26,80 26,74 L26,34 Q26,28 32,28"/>
<path android:fillColor="${secondary}" android:pathData="M66,50 A18,18 0,1 1,65.99,50"/>
<path android:strokeColor="#16131d" android:strokeWidth="3" android:strokeLineCap="round" android:fillColor="#00000000" android:pathData="M66,56 L66,68 L73,68"/>
</vector>`;
          writes.push(write("drawable", `${name}.xml`, vector));
          writes.push(write("mipmap-anydpi", `${name}.xml`, vector));
          writes.push(
            write(
              "mipmap-anydpi-v26",
              `${name}.xml`,
              `<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@android:color/black"/><foreground android:drawable="@drawable/${name}"/></adaptive-icon>`,
            ),
          );
        }
      }
      for (const [qualifier, field] of [
        ["values-v33", "lightBackground"],
        ["values-night-v33", "darkBackground"],
      ]) {
        const styles = swatches.lightBackground
          .flatMap((_, l) =>
            swatches.darkBackground.map((_dark, d) => {
              const color = swatches[field][field === "lightBackground" ? l : d];
              return `<style name="ThemeSplash_${l}_${d}" parent="AppTheme"><item name="android:windowSplashScreenBackground">${color}</item><item name="android:windowBackground">${color}</item></style>`;
            }),
          )
          .join("\n");
        writes.push(
          write(qualifier, "theme-appearance.xml", `<resources>\n${styles}\n</resources>`),
        );
      }
      for (const [dir, color] of [
        ["values-v31", swatches.lightBackground[0]],
        ["values-night-v31", swatches.darkBackground[0]],
      ]) {
        writes.push(
          write(
            dir,
            "theme-appearance-default.xml",
            `<resources><style name="Theme.App.SplashScreen" parent="AppTheme"><item name="android:windowSplashScreenBackground">${color}</item></style></resources>`,
          ),
        );
      }
      writes.push(
        write(
          "raw",
          "theme_appearance_keep.xml",
          '<resources xmlns:tools="http://schemas.android.com/tools" tools:keep="@style/ThemeSplash_*,@mipmap/theme_icon_*"/>',
        ),
      );
      await Promise.all(writes);
      return mod;
    },
  ]);
};
