import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { relative } from "node:path";
import { ciScope } from "./affected.ts";

const run = (args: string[]) => {
  const result = spawnSync("vp", args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};
const base = process.env["CI_BASE"];
const exec = (command: string, args: string[]) => {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout;
};
const changed = base
  ? exec("git", ["diff", "--name-only", `${base}...HEAD`])
      .trim()
      .split("\n")
  : [];
// Shared configuration, tooling and native modules affect the whole workspace.
const { all, mobile } = ciScope(base, changed);
const selected: { name: string; path: string }[] = JSON.parse(
  exec("pnpm", ["--filter", all ? "*" : `...[${base}]`, "list", "--depth", "-1", "--json"]),
);
const paths = selected.map((pkg) => relative(process.cwd(), pkg.path)).filter(Boolean);
if (process.env["GITHUB_OUTPUT"])
  appendFileSync(process.env["GITHUB_OUTPUT"], `mobile=${mobile}\n`);
if (process.argv.includes("--plan")) {
  console.log(JSON.stringify({ paths, mobile, all }));
} else if (paths.length || all) {
  run(["check", "--no-lint", ...(all ? [] : paths)]);
  // Vitest's default project names are package names; apps with a custom config name theirs.
  const names: Record<string, string> = {
    "@app/web": "web",
    "@app/mobile": "mobile",
    "@app/client-data": "client-data",
  };
  run([
    "test",
    "run",
    ...(all ? [] : selected.flatMap((pkg) => ["--project", names[pkg.name] ?? pkg.name])),
  ]);
  if (paths.includes("apps/web")) run(["run", "--filter", "@app/web", "build"]);
  if (paths.includes("apps/web")) run(["run", "--filter", "@app/web", "build-storybook"]);
  if (paths.includes("apps/mobile"))
    run([
      "exec",
      "--filter",
      "@app/mobile",
      "expo",
      "export",
      "--platform",
      "android",
      "--max-workers",
      "2",
      "--output-dir",
      `${process.env["RUNNER_TEMP"] ?? "/tmp"}/anki-mobile-ci`,
    ]);
}

if (paths.includes("apps/mobile") && !process.argv.includes("--plan"))
  run(["run", "--filter", "@app/mobile", "build-storybook"]);
