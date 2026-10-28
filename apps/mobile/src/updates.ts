import { newerApk } from "@app/core";
import { nativeBuildVersion } from "expo-application";
import * as FileSystem from "expo-file-system/legacy";
import { startActivityAsync } from "expo-intent-launcher";

/** Called from Home only. Never mount update prompts in alarm or study screens. */
export async function findApk() {
  const installed = Number(nativeBuildVersion);
  if (!Number.isSafeInteger(installed) || installed < 1) return undefined;
  // Walk past OTA-only releases; GitHub's /latest endpoint cannot answer this question.
  /* Sequential pagination stops at the first APK; later pages are unnecessary. */
  /* eslint-disable no-await-in-loop */
  for (let page = 1; ; page++) {
    const response = await fetch(
      `https://api.github.com/repos/YgorPerez/anki-alarm/releases?per_page=100&page=${page}`,
    );
    if (!response.ok) throw new Error("Release check failed");
    const releases = await response.json();
    const apk = newerApk(releases, installed);
    if (apk || releases.length < 100) return apk;
  }
}

export async function installApk(url: string) {
  const destination = `${FileSystem.cacheDirectory}anki-alarm.apk`;
  const download = await FileSystem.downloadAsync(url, destination);
  if (download.status !== 200) throw new Error("APK download failed");
  const uri = await FileSystem.getContentUriAsync(download.uri);
  // Android owns installation and the per-app "allow unknown sources" consent.
  await startActivityAsync("android.intent.action.VIEW", {
    data: uri,
    type: "application/vnd.android.package-archive",
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
  });
}
