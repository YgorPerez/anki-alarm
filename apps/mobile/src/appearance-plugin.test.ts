import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { THEME_SWATCHES } from "@app/core";

const require = createRequire(import.meta.url);
const plugin = require("../plugins/with-theme-appearance.js");

test("prebuild keeps deep links and unrelated aliases, with exactly one enabled theme launcher", async () => {
  const config = plugin({ name: "Test", slug: "test" }, { swatches: THEME_SWATCHES });
  const deepLink = { action: [{ $: { "android:name": "android.intent.action.VIEW" } }] };
  const app = {
    $: {},
    activity: [
      {
        $: { "android:name": ".MainActivity" },
        "intent-filter": [
          { category: [{ $: { "android:name": "android.intent.category.LAUNCHER" } }] },
          deepLink,
        ],
      },
    ],
    "activity-alias": [{ $: { "android:name": ".OtherAlias" } as Record<string, string> }],
  };
  await config.mods.android.manifest({
    modRequest: {},
    modResults: { manifest: { application: [app] } },
  });
  const aliases = app["activity-alias"];
  expect(aliases).toHaveLength(21);
  expect(aliases.filter((a) => a.$["android:enabled"] === "true")).toHaveLength(1);
  expect(app.activity[0]!["intent-filter"]).toEqual([deepLink]);
});

test("prebuild ships light and night splash grounds and adaptive icons for every pair", async () => {
  const root = await mkdtemp(join(tmpdir(), "theme-prebuild-"));
  try {
    const config = plugin({ name: "Test", slug: "test" }, { swatches: THEME_SWATCHES });
    await config.mods.android.dangerous({ modRequest: { platformProjectRoot: root } });
    const res = join(root, "app/src/main/res");
    expect(await readFile(join(res, "values-v33/theme-appearance.xml"), "utf8")).toContain(
      '<item name="android:windowSplashScreenBackground">#f7f5fb</item>',
    );
    expect(await readFile(join(res, "values-night-v33/theme-appearance.xml"), "utf8")).toContain(
      '<item name="android:windowSplashScreenBackground">#0b1220</item>',
    );
    expect(await readFile(join(res, "mipmap-anydpi-v26/theme_icon_4_3.xml"), "utf8")).toContain(
      "<adaptive-icon",
    );
    const vector = await readFile(join(res, "drawable/theme_icon_4_3.xml"), "utf8");
    expect(vector).toContain("#ff9ec7");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
