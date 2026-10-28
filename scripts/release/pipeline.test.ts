import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

const script = (name: string) => fileURLToPath(new URL(name, import.meta.url));

test("release preparation refuses a non-release ref", () => {
  expect(() =>
    execFileSync(process.execPath, [script("prepare.ts")], {
      env: { ...process.env, GITHUB_REF_NAME: "main" },
      stdio: "pipe",
    }),
  ).toThrow("Invalid release tag");
});

test("release scripts choose APK or OTA from paginated release metadata without publishing", () => {
  const cwd = mkdtempSync(join(tmpdir(), "anki-release-"));
  try {
    // Fake only GitHub's HTTP transport. Run the actual release entry points.
    writeFileSync(
      join(cwd, "gh"),
      `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes('--slurp')) console.log(process.env.RELEASES);
else console.log(process.env.METADATA);
`,
      { mode: 0o700 },
    );
    const env = {
      ...process.env,
      PATH: `${cwd}:${process.env["PATH"]}`,
      GITHUB_REF_NAME: "v1.4.2",
      GITHUB_OUTPUT: join(cwd, "outputs"),
    };
    execFileSync(process.execPath, [script("prepare.ts")], { cwd, env });
    expect(JSON.parse(readFileSync(join(cwd, "release-version.json"), "utf8"))).toEqual({
      version: "1.4.2",
      versionCode: 10402,
    });
    writeFileSync(join(cwd, "fingerprint.json"), JSON.stringify({ hash: "a".repeat(40) }));
    const run = (releases: unknown, fingerprint: string) => {
      writeFileSync(env.GITHUB_OUTPUT, "");
      execFileSync(process.execPath, [script("compare.ts")], {
        cwd,
        env: {
          ...env,
          RELEASES: JSON.stringify(releases),
          METADATA: JSON.stringify({ fingerprint, versionCode: 10401 }),
        },
      });
      return readFileSync(env.GITHUB_OUTPUT, "utf8");
    };
    expect(run([[]], "")).toBe("apk=true\n");
    const releases = [
      [{ draft: false, prerelease: false, assets: [] }],
      [
        {
          draft: false,
          prerelease: false,
          assets: [{ name: "anki-alarm.apk" }, { name: "release-metadata.json", id: 42 }],
        },
      ],
    ];
    expect(run(releases, "a".repeat(40))).toBe("apk=false\n");
    expect(run(releases, "b".repeat(40))).toBe("apk=true\n");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
