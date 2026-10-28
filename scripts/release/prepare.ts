import { appendFileSync, writeFileSync } from "node:fs";
import { releaseVersion } from "../../packages/core/src/index.ts";

const tag = process.env["GITHUB_REF_NAME"] ?? "";
const version = releaseVersion(tag);
writeFileSync("release-version.json", JSON.stringify(version));
appendFileSync(
  process.env["GITHUB_OUTPUT"]!,
  `version=${version.version}\nversion_code=${version.versionCode}\n`,
);
