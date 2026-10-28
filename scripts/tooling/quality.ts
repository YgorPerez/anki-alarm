import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { relative, isAbsolute } from "node:path";
import { checkCeiling, type Counts } from "./ceiling.ts";

type Baseline = Record<string, Counts>;
const baselinePath = "scripts/tooling/baseline.json";
const run = (command: string, args: string[]) => {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: "1" },
  });
  if (result.error || result.status === null || result.status > 1)
    throw new Error(`${command}: ${result.error ?? result.stderr}`);
  return JSON.parse(result.stdout);
};
const count = (files: string[]): Counts => {
  const counts: Counts = {};
  for (const file of files) {
    const key = isAbsolute(file) ? relative(process.cwd(), file) : file;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
};
const plan = process.env["CI_BASE"] ? JSON.parse(runPlan()) : undefined;
const scope: string[] | undefined = plan?.all ? undefined : plan?.paths;
function runPlan(): string {
  const result = spawnSync("node", ["scripts/tooling/ci.ts", "--plan"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout;
}
const inScope = (file: string) =>
  !scope || scope.some((path) => file === path || file.startsWith(path + "/"));
const oxlint =
  scope?.length === 0
    ? { diagnostics: [] }
    : run("vp", ["lint", "--format", "json", ...(scope ?? [])]);
const fallow = run("fallow", ["dead-code", "--format", "json", "--quiet"]);
const dupes = run("fallow", ["dupes", "--format", "json", "--quiet"]);
const reactProjects = ["apps/mobile", "apps/web"].filter(inScope);
const doctor =
  reactProjects.length === 0
    ? { ok: true, projects: [] }
    : run("react-doctor", [
        "--project",
        reactProjects.join(","),
        "--yes",
        "--no-score",
        "--no-supply-chain",
        "--no-parallel",
        "--json",
      ]);
if (
  !doctor.ok ||
  doctor.projects.some((project: { skippedChecks: string[] }) => project.skippedChecks.length > 0)
)
  throw new Error("React Doctor did not complete");
const fallowFiles: string[] = [];
for (const [key, value] of Object.entries(fallow)) {
  if (
    key.startsWith("unused_") ||
    key === "unresolved_imports" ||
    key === "unlisted_dependencies"
  ) {
    if (Array.isArray(value))
      for (const finding of value)
        fallowFiles.push(finding.path ?? finding.file ?? finding.file_path);
  }
}
// Fail closed when a new finding type isn't covered by the report adapter.
if (
  fallowFiles.length !== fallow.total_issues ||
  fallowFiles.some((file) => typeof file !== "string")
)
  throw new Error("Unrecognized Fallow finding; update quality.ts");
if (
  fallow.workspace_diagnostics.some(
    (item: { degrades_analysis?: boolean }) => item.degrades_analysis,
  )
)
  throw new Error("Fallow analysis is incomplete");
for (const group of dupes.clone_groups)
  for (const instance of group.instances) fallowFiles.push(instance.file);
const actual: Baseline = {
  oxlint: count(
    oxlint.diagnostics.map((finding: { filename: string }) => finding.filename).filter(inScope),
  ),
  fallow: count(fallowFiles.filter(inScope)),
  "react-doctor": count(
    doctor.projects.flatMap(
      (project: { packageRoot: string; diagnostics: { filePath: string }[] }) =>
        project.diagnostics.map(
          (finding) => `${relative(process.cwd(), project.packageRoot)}/${finding.filePath}`,
        ),
    ),
  ),
};
if (process.argv.includes("--snapshot")) {
  writeFileSync(baselinePath, JSON.stringify(actual, null, 2) + "\n");
} else {
  const baseline: Baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const base = process.env["QUALITY_BASE"] ?? process.env["CI_BASE"];
  let previous = baseline;
  if (base && !/^0+$/.test(base)) {
    const result = spawnSync("git", ["show", `${base}:${baselinePath}`], { encoding: "utf8" });
    if (result.status === 0) previous = JSON.parse(result.stdout);
    else if (spawnSync("git", ["cat-file", "-e", base]).status !== 0)
      throw new Error(`Missing quality base ${base}`);
  }
  const errors = Object.entries(actual).flatMap(([tool, counts]) =>
    checkCeiling(baseline[tool] ?? {}, counts, previous[tool] ?? {}).map(
      (error) => `${tool}: ${error}`,
    ),
  );
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("All per-file violation ceilings pass.");
}
