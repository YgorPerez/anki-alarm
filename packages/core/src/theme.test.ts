import { describe, expect, test } from "vite-plus/test";

import {
  contrast,
  FACTORY_THEME,
  lookAlikes,
  parseThemeChoice,
  THEME_SWATCHES,
  themeFor,
  toHex,
  type Hex,
  type Theme,
  type ThemeChoice,
  type ThemeMode,
} from "./index.ts";

const MODES: ThemeMode[] = ["light", "dark"];

// What text sits on, as DESIGN.md's components draw it.
const PAIRS = [
  ["foreground", "background"],
  ["muted-foreground", "background"],
  ["answer", "background"],
  ["foreground", "surface"],
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
  ["destructive", "background"],
] as const;

describe("contrast", () => {
  test("is WCAG's ratio, whichever color is first", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21);
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });
});

describe("toHex", () => {
  test("reads #rrggbb in any case, with or without the #", () => {
    expect(toHex("#8BE3A0")).toBe("#8be3a0");
    expect(toHex(" 8be3a0 ")).toBe("#8be3a0");
  });

  test("rejects anything else", () => {
    for (const text of ["", "#fff", "#12345g", "red", "#1234567"])
      expect(toHex(text)).toBeUndefined();
  });
});

describe("the factory theme", () => {
  test("is the first swatch of every field", () => {
    const firsts = Object.entries(THEME_SWATCHES).map(([field, swatches]) => [field, swatches[0]]);
    expect(Object.fromEntries(firsts)).toEqual(FACTORY_THEME);
  });

  test("has no look-alikes", () => {
    expect(lookAlikes(FACTORY_THEME)).toEqual([]);
  });

  test("keeps the grade hues and the secondary as chosen on dark", () => {
    const dark = themeFor(FACTORY_THEME, "dark");
    expect(dark.background).toBe("#000000");
    expect(dark.primary).toBe("#c9b6ff");
    expect(dark.attention).toBe("#ffb89a");
    expect(dark.again).toBe("#ff7a9a");
  });

  test("deepens the primary on white so white ink reads on it", () => {
    const light = themeFor(FACTORY_THEME, "light");
    expect(light.primary).toBe("#8169b8");
    expect(light["primary-foreground"]).toBe("#ffffff");
  });
});

describe("themeFor", () => {
  test("uses the background chosen for the mode", () => {
    const choice = {
      ...FACTORY_THEME,
      lightBackground: "#f6f4ef",
      darkBackground: "#0b1220",
    } as const;
    expect(themeFor(choice, "light").background).toBe("#f6f4ef");
    expect(themeFor(choice, "dark").background).toBe("#0b1220");
  });

  test("gives light and dark the same tokens", () => {
    expect(Object.keys(themeFor(FACTORY_THEME, "light"))).toEqual(
      Object.keys(themeFor(FACTORY_THEME, "dark")),
    );
  });

  test("Good follows the primary unless it has its own color", () => {
    const green = { ...FACTORY_THEME, primary: "#7fd4ff" } as const;
    expect(themeFor(green, "dark").good).toBe("#7fd4ff");
    expect(themeFor({ ...green, good: "#8be3a0" }, "dark").good).toBe("#8be3a0");
  });

  test("Delete stays red whatever the theme", () => {
    const rose = { ...FACTORY_THEME, primary: "#ff6b6b", again: "#ff6b6b" } as const;
    for (const mode of MODES)
      expect(themeFor(rose, mode).destructive).toBe(themeFor(FACTORY_THEME, mode).destructive);
  });

  // Every swatch, and free picks across the range (mid grays are the hard grounds: neither
  // white nor near-black text clears AA on them by much).
  const SWEEP: Hex[] = [
    "#000000",
    "#ffffff",
    "#777777",
    "#808080",
    "#8a8a8a",
    "#959595",
    "#3a3a3a",
    "#ff0000",
    "#ffff00",
    "#00ff00",
    "#0000ff",
    "#00ffff",
    "#ff00ff",
    "#7a5c00",
    "#1d2b4f",
    "#fffbe6",
  ];
  const choices: ThemeChoice[] = [
    ...SWEEP.map((ground) => ({
      ...FACTORY_THEME,
      lightBackground: ground,
      darkBackground: ground,
    })),
    ...SWEEP.map((color) => ({
      ...FACTORY_THEME,
      primary: color,
      secondary: color,
      again: color,
      hard: color,
      easy: color,
    })),
    ...SWEEP.flatMap((ground) =>
      SWEEP.map((color) => ({
        lightBackground: ground,
        darkBackground: ground,
        primary: color,
        secondary: color,
        again: color,
        hard: color,
        good: color,
        easy: color,
      })),
    ),
    ...Object.entries(THEME_SWATCHES).flatMap(([field, swatches]) =>
      swatches.map((swatch) => ({ ...FACTORY_THEME, [field]: swatch })),
    ),
  ];

  // Derived once, for both tests below.
  let derived: { choice: ThemeChoice; mode: ThemeMode; theme: Theme }[] | undefined;
  const themes = () =>
    (derived ??= choices.flatMap((choice) =>
      MODES.map((mode) => ({ choice, mode, theme: themeFor(choice, mode) })),
    ));

  test("every text meets WCAG AA on what it sits on, whatever the choice", () => {
    const failures = themes().flatMap(({ choice, mode, theme }) =>
      PAIRS.filter(([text, ground]) => contrast(theme[text], theme[ground]) < 4.5).map(
        ([text, ground]) => `${mode} ${JSON.stringify(choice)}: ${text} on ${ground}`,
      ),
    );
    expect(failures).toEqual([]);
  }, 20_000);

  test("every token is a #rrggbb literal", () => {
    const values = themes().flatMap(({ theme }) => Object.values(theme));
    expect(values.filter((value) => !/^#[0-9a-f]{6}$/.test(value))).toEqual([]);
  }, 20_000);
});

describe("lookAlikes", () => {
  test("names two grades that look alike", () => {
    expect(lookAlikes({ ...FACTORY_THEME, hard: "#ff7f9c" })).toEqual([["again", "hard"]]);
  });

  test("compares the primary and the secondary with the grades", () => {
    expect(lookAlikes({ ...FACTORY_THEME, secondary: "#7fe0cf" })).toEqual([["easy", "secondary"]]);
  });

  test("doesn't count Good following the primary as a look-alike", () => {
    expect(lookAlikes({ ...FACTORY_THEME, good: "primary" })).toEqual([]);
    expect(lookAlikes({ ...FACTORY_THEME, good: "#c9b6ff" })).toEqual([["good", "primary"]]);
  });
});

describe("parseThemeChoice", () => {
  test("reads back a saved choice", () => {
    const choice = { ...FACTORY_THEME, primary: "#7fd4ff", good: "#8be3a0" } as const;
    expect(parseThemeChoice(JSON.parse(JSON.stringify(choice)))).toEqual(choice);
  });

  test("keeps the factory color for a missing or broken field", () => {
    expect(parseThemeChoice({ primary: "#7FD4FF", hard: "yellow", good: 3 })).toEqual({
      ...FACTORY_THEME,
      primary: "#7fd4ff",
    });
    expect(parseThemeChoice(null)).toEqual(FACTORY_THEME);
    expect(parseThemeChoice("#7fd4ff")).toEqual(FACTORY_THEME);
  });

  test("only Good can follow the primary", () => {
    expect(parseThemeChoice({ good: "primary", easy: "primary" })).toEqual(FACTORY_THEME);
  });
});
