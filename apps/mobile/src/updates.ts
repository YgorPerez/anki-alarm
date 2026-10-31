import { newerApk } from "@app/core";
import { nativeBuildVersion } from "expo-application";
import * as FileSystem from "expo-file-system/legacy";
import { startActivityAsync } from "expo-intent-launcher";
import * as Updates from "expo-updates";

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

export async function downloadApk(url: string, onProgress: (percent: number) => void) {
  const download = FileSystem.createDownloadResumable(
    url,
    `${FileSystem.cacheDirectory}anki-alarm.apk`,
    {},
    ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
      if (totalBytesExpectedToWrite > 0)
        onProgress(Math.floor((totalBytesWritten / totalBytesExpectedToWrite) * 100));
    },
  );
  const result = await download.downloadAsync();
  if (result?.status !== 200) throw new Error("APK download failed");
  return result.uri;
}

/** Resolves when the installer closes, installed or not: a cancelled install can open it again. */
export async function openInstaller(file: string) {
  const uri = await FileSystem.getContentUriAsync(file);
  // Android owns installation and the per-app "allow unknown sources" consent.
  await startActivityAsync("android.intent.action.VIEW", {
    data: uri,
    type: "application/vnd.android.package-archive",
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
  });
}

/** Downloads a published OTA, if there is one. It applies on the next cold start. */
export async function fetchOtaInBackground() {
  try {
    if (!Updates.isEnabled) return;
    const check = await Updates.checkForUpdateAsync();
    if (check.isAvailable) await Updates.fetchUpdateAsync();
  } catch {
    // Offline or no update channel: the APK offer still applies.
  }
}
