import { expect, test } from "vite-plus/test";
import { releaseVersion, newerApk, releaseArtifact } from "./index.ts";

test("release tags produce the Android versions from ADR 0002", () => {
  expect(releaseVersion("v1.4.2")).toEqual({ version: "1.4.2", versionCode: 10402 });
  for (const tag of ["1.4.2", "v1.4.2-beta", "v1.100.0", "v1.0.100", "v01.0.0"]) {
    expect(() => releaseVersion(tag)).toThrow("Invalid release tag");
  }
});

test("OTA releases are skipped when looking for a newer installable APK", () => {
  const releases = [
    { tag_name: "v1.4.4", draft: false, prerelease: false, assets: [] },
    {
      tag_name: "v1.4.3",
      draft: false,
      prerelease: false,
      assets: [
        {
          name: "anki-alarm.apk",
          browser_download_url:
            "https://github.com/YgorPerez/anki-alarm/releases/download/v1.4.3/anki-alarm.apk",
          size: 131162716,
        },
      ],
    },
  ];
  expect(newerApk(releases, 10402)).toMatchObject({ versionCode: 10403, size: 131162716 });
  expect(newerApk(releases, 10403)).toBeUndefined();
  expect(newerApk(releases, 10404)).toBeUndefined();
});

test("a first APK or a changed runtime needs an APK; a matching runtime uses OTA", () => {
  expect(releaseArtifact("new")).toBe("apk");
  expect(releaseArtifact("new", "old")).toBe("apk");
  expect(releaseArtifact("same", "same")).toBe("ota");
});

test("preview releases and assets outside the release are never install offers", () => {
  const asset = {
    name: "anki-alarm.apk",
    browser_download_url: "https://example.com/app.apk",
    size: 1,
  };
  expect(
    newerApk([{ tag_name: "v2.0.0", draft: false, prerelease: false, assets: [asset] }], 1),
  ).toBeUndefined();
  expect(
    newerApk([{ tag_name: "v2.0.0", draft: true, prerelease: false, assets: [asset] }], 1),
  ).toBeUndefined();
});
