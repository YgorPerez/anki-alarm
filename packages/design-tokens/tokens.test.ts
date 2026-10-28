// Keeps tokens.css, web.css and DESIGN.md in step, and checks the factory theme's contrast.
// Runs on Node's own runner (`node --test`) until the workspace's test runner exists.
// When Core's theme module lands, add: Core's factory theme derives exactly these values.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const tokensCss = read("./tokens.css");
const webCss = read("./web.css");
const designMd = read("../../DESIGN.md");

type Theme = Map<string, string>;

const variant = (name: "light" | "dark"): Theme => {
  const block = new RegExp(`@variant ${name} \\{([^}]*)\\}`).exec(tokensCss)?.[1];
  assert.ok(block, `tokens.css has a ${name} variant`);
  return new Map([...block.matchAll(/--color-([\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
};
const light = variant("light");
const dark = variant("dark");

const channel = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

test("light and dark define the same colors", () => {
  assert.deepEqual([...light.keys()].sort(), [...dark.keys()].sort());
});

test("every color is a plain #rrggbb literal", () => {
  for (const [name, value] of [...light, ...dark]) assert.match(value, /^#[0-9a-f]{6}$/, name);
});

test("web.css registers exactly the colors tokens.css defines", () => {
  const registered = [...webCss.matchAll(/--color-([\w-]+):\s*unset;/g)].map((m) => m[1]);
  assert.deepEqual(registered.sort(), [...light.keys()].sort());
});

test("web.css's shadcn aliases point at defined colors", () => {
  for (const [, alias, target] of webCss.matchAll(/--([\w-]+):\s*var\(--color-([\w-]+)\);/g)) {
    assert.equal(alias, target, "an alias keeps its token's name");
    assert.ok(light.has(target!), `${target} is a token`);
  }
});

test("DESIGN.md's colors match tokens.css", () => {
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(designMd)?.[1] ?? "";
  const colors = /^colors:\n((?: {2}.+\n)+)/m.exec(frontmatter + "\n")?.[1] ?? "";
  const entries = [...colors.matchAll(/^ {2}([\w-]+): "(#[0-9a-f]{6})"$/gm)];
  assert.ok(entries.length > 0, "DESIGN.md has colors");
  for (const [, key, value] of entries) {
    const isDark = key!.endsWith("-dark");
    const name = isDark ? key!.slice(0, -"-dark".length) : key!;
    assert.equal((isDark ? dark : light).get(name), value, key);
  }
});

const PAIRS: [text: string, ground: string][] = [
  ["foreground", "background"],
  ["muted-foreground", "background"],
  ["primary-foreground", "primary"],
  ["primary-ink", "background"],
  ["attention", "background"],
  ["attention", "attention-tint"],
  ["good-foreground", "good"],
  ["again", "again-tint"],
  ["hard", "hard-tint"],
  ["easy", "easy-tint"],
  ["again-ink", "background"],
  ["hard-ink", "background"],
  ["easy-ink", "background"],
  ["foreground", "surface"],
  ["destructive", "background"],
];

for (const [mode, theme] of [["light", light], ["dark", dark]] as const) {
  test(`${mode}: text meets WCAG AA on what it sits on`, () => {
    for (const [text, ground] of PAIRS) {
      const ratio = contrast(theme.get(text)!, theme.get(ground)!);
      assert.ok(ratio >= 4.5, `${text} on ${ground}: ${ratio.toFixed(2)}`);
    }
  });
}
