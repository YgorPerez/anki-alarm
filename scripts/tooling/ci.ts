import { spawn, spawnSync } from "node:child_process";
import { relative } from "node:path";
import { ciScope } from "./affected.ts";

const run = (args: string[]) => {
  const result = spawnSync("vp", args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};
const runAsync = (args: string[]) =>
  new Promise<void>((resolve) => {
    spawn("vp", args, { stdio: "inherit" }).on("close", (status) => {
      if (status !== 0) process.exit(status ?? 1);
      resolve();
    });
  });
// Runs each group's commands in order, with the groups side by side, to stay under the CI timeout.
const runGroups = (groups: string[][][]) =>
  Promise.all(
    groups.map((group) =>
      group.reduce((previous, args) => previous.then(() => runAsync(args)), Promise.resolve()),
    ),
  );
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
      .filter(Boolean)
  : [];
// Shared configuration, tooling and native modules affect the whole workspace.
const { all } = ciScope(base, changed);
const selected: { name: string; path: string }[] = JSON.parse(
  exec("pnpm", ["--filter", all ? "*" : `...[${base}]`, "list", "--depth", "-1", "--json"]),
);
const paths = selected.map((pkg) => relative(process.cwd(), pkg.path)).filter(Boolean);
if (process.argv.includes("--plan")) {
  console.log(JSON.stringify({ paths, all }));
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
  const web = [
    ["run", "--filter", "@app/web", "build"],
    ["run", "--filter", "@app/web", "build-storybook"],
    ["exec", "--filter", "@app/web", "playwright", "install", "--with-deps", "chromium"],
    ["run", "--filter", "@app/web", "test:e2e"],
  ];
  const mobile = [
    [
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
    ],
    ["run", "--filter", "@app/mobile", "build-storybook"],
  ];
  await runGroups([
    ...(paths.includes("apps/web") ? [web] : []),
    ...(paths.includes("apps/mobile") ? [mobile] : []),
  ]);
}
