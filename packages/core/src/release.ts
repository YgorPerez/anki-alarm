/** The two-digit minor and patch fields keep ADR 0002's versionCode unambiguous. */
export function releaseVersion(tag: string) {
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d?)\.(0|[1-9]\d?)$/.exec(tag);
  if (!match) throw new Error(`Invalid release tag: ${tag}`);
  const versionCode = Number(match[1]) * 10000 + Number(match[2]) * 100 + Number(match[3]);
  if (versionCode < 1 || versionCode > 2100000000)
    throw new Error("Android versionCode out of range");
  return { version: tag.slice(1), versionCode };
}

interface Release {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: { name: string; browser_download_url: string; size: number }[];
}

/** GitHub returns newest first; ignore notes-only releases and untrusted asset URLs. */
export function newerApk(releases: readonly Release[], installedVersionCode: number) {
  for (const release of releases) {
    if (release.draft || release.prerelease) continue;
    let version;
    try {
      version = releaseVersion(release.tag_name);
    } catch {
      continue;
    }
    const asset = release.assets.find(
      (item) =>
        item.name === "anki-alarm.apk" &&
        item.browser_download_url ===
          `https://github.com/YgorPerez/anki-alarm/releases/download/${release.tag_name}/anki-alarm.apk`,
    );
    if (asset)
      return version.versionCode > installedVersionCode
        ? { ...version, url: asset.browser_download_url, size: asset.size }
        : undefined;
  }
  return undefined;
}

// 2: alarm journal events sync (#60); a client on 1 would fail to decode them.
// 3: reviews carry their frozen scheduling options (ADR 0008); a client on 2 would replay them under
//    its current preset, and two copies of a legacy review now merge instead of only appending.
export const SYNC_PROTOCOL = 3;

export function releaseArtifact(fingerprint: string, latestApkFingerprint?: string) {
  return fingerprint === latestApkFingerprint ? "ota" : "apk";
}
