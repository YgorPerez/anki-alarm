import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";

const root = fileURLToPath(new URL("../../", import.meta.url));
function lint(source: string, app = "mobile") {
  const directory = mkdtempSync(join(root, `apps/${app}/radius-fixture-`));
  const file = join(directory, "fixture.tsx");
  try {
    writeFileSync(file, source);
    const result = spawnSync(
      join(root, "node_modules/.bin/vp"),
      ["lint", file, "--format", "json"],
      {
        cwd: root,
        encoding: "utf8",
      },
    );
    const output = JSON.parse(result.stdout);
    return output.diagnostics.filter((item: { code: string }) => item.code?.includes("two-radius"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("mobile lint rejects radius classes outside the two-token scale", { timeout: 30_000 }, () => {
  expect(
    lint('export const classes = "rounded-sm hover:rounded-xl rounded-[12px] rounded-full";'),
  ).toHaveLength(4);
});

test(
  "mobile lint checks template classes and inline radius values, including individual corners",
  { timeout: 30_000 },
  () => {
    expect(
      lint(`export const classes = \`p-4 \${true ? "rounded-lg" : "rounded-pill"} rounded-md\`;
export const styles = { borderRadius: 8, borderTopLeftRadius: 20, "borderBottomEndRadius": "50%" };`),
    ).toHaveLength(4);
  },
);

test(
  "mobile lint accepts pill and 16px containers and leaves web radii alone",
  { timeout: 30_000 },
  () => {
    expect(
      lint(
        'export const classes = "rounded-lg active:rounded-pill"; export const styles = { borderRadius: 16, borderTopStartRadius: 999 };',
      ),
    ).toEqual([]);
    expect(
      lint(
        'export const classes = "rounded-sm rounded-full"; export const styles = { borderRadius: 8 };',
        "web",
      ),
    ).toEqual([]);
  },
);

test(
  "mobile lint rejects computed radius values and split radius class names",
  { timeout: 30_000 },
  () => {
    expect(
      lint(
        'export const radius = 12; export const styles = { ["borderRadius"]: radius }; export const classes = `rounded-${radius}`;',
      ),
    ).toHaveLength(2);
  },
);

test(
  "mobile lint covers JSX classes, radius props, and later style assignments",
  { timeout: 30_000 },
  () => {
    expect(
      lint(
        'export const view = <View className="rounded-xl" borderRadius={8} />; export const style = { borderRadius: 16 }; style.borderRadius = 12;',
      ),
    ).toHaveLength(3);
  },
);
