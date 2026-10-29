import { releaseArtifact } from "../../packages/core/src/index.ts";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const fingerprint = JSON.parse(readFileSync("fingerprint.json", "utf8")).hash;
if (typeof fingerprint !== "string" || !/^[a-f0-9]{40,64}$/.test(fingerprint)) {
  throw new Error("Missing Android fingerprint");
}
// Paginate: there may be many notes-only OTA releases since the latest APK.
const releases = JSON.parse(
  execFileSync(
    "gh",
    ["api", "--paginate", "--slurp", "repos/YgorPerez/anki-alarm/releases?per_page=100"],
    { encoding: "utf8" },
  ),
).flat();
const latestApk = releases.find(
  (release: { draft: boolean; prerelease: boolean; assets: { name: string }[] }) =>
    !release.draft &&
    !release.prerelease &&
    release.assets.some((asset) => asset.name === "anki-alarm.apk"),
);
let previous;
if (latestApk) {
  const asset = latestApk.assets.find(
    (item: { name: string }) => item.name === "release-metadata.json",
  );
  if (!asset) throw new Error("Latest APK has no release metadata; migrate it before releasing");
  previous = JSON.parse(
    execFileSync(
      "gh",
      [
        "api",
        "-H",
        "Accept: application/octet-stream",
        `repos/YgorPerez/anki-alarm/releases/assets/${asset.id}`,
      ],
      { encoding: "utf8" },
    ),
  );
}
const version = JSON.parse(readFileSync("release-version.json", "utf8"));
if (previous && version.versionCode <= previous.versionCode)
  throw new Error("Tag must be newer than latest APK");
const apk = releaseArtifact(fingerprint, previous?.fingerprint) === "apk";
writeFileSync("release-metadata.json", JSON.stringify({ ...version, fingerprint }, null, 2));
appendFileSync(process.env["GITHUB_OUTPUT"]!, `apk=${apk}\n`);
