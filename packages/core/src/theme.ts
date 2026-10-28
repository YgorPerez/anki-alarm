// The user's theme: their color choices, the swatches to pick from, and every `--color-*` token
// derived from them by the rules in DESIGN.md › Colors › Theme (ADR 0004).

/** A color as `#rrggbb`, lowercase. */
export type Hex = `#${string}`;

export type ThemeMode = "light" | "dark";

/** What the user picks in Settings › Theme. Each field syncs on its own. */
export type ThemeChoice = {
  lightBackground: Hex;
  darkBackground: Hex;
  /** Action: Good, Start, progress. */
  primary: Hex;
  /** Attention: cards left, snooze. The `attention` token. */
  secondary: Hex;
  again: Hex;
  hard: Hex;
  /** `"primary"` follows the primary. */
  good: Hex | "primary";
  easy: Hex;
};

export type ThemeField = keyof ThemeChoice;

/** Each field's swatches; the first is the factory color. */
export const THEME_SWATCHES: { readonly [F in ThemeField]: readonly ThemeChoice[F][] } = {
  lightBackground: ["#ffffff", "#f7f5fb", "#f6f4ef", "#f2f5f8"],
  darkBackground: ["#000000", "#0a0812", "#0b1220", "#121212"],
  primary: ["#c9b6ff", "#7fd4ff", "#8be3a0", "#ffd166", "#ff9ec7"],
  secondary: ["#ffb89a", "#ffd166", "#7fe0cf", "#ff9ec7"],
  again: ["#ff7a9a", "#ff6b6b", "#ff9ec7"],
  hard: ["#ffe066", "#ffcf7a", "#e6d27a"],
  good: ["primary", "#8be3a0", "#7fd4ff"],
  easy: ["#7fe0cf", "#7fd4ff", "#b6e37f"],
};

export const FACTORY_THEME: ThemeChoice = {
  lightBackground: THEME_SWATCHES.lightBackground[0]!,
  darkBackground: THEME_SWATCHES.darkBackground[0]!,
  primary: THEME_SWATCHES.primary[0]!,
  secondary: THEME_SWATCHES.secondary[0]!,
  again: THEME_SWATCHES.again[0]!,
  hard: THEME_SWATCHES.hard[0]!,
  good: THEME_SWATCHES.good[0]!,
  easy: THEME_SWATCHES.easy[0]!,
};

/** Every color token, by its name without `--color-`. Same names as `tokens.css`. */
export type Theme = Record<
  | "background"
  | "foreground"
  | "card"
  | "card-foreground"
  | "popover"
  | "popover-foreground"
  | "primary"
  | "primary-foreground"
  | "secondary"
  | "secondary-foreground"
  | "muted"
  | "muted-foreground"
  | "accent"
  | "accent-foreground"
  | "destructive"
  | "border"
  | "input"
  | "ring"
  | "chart-1"
  | "chart-2"
  | "chart-3"
  | "chart-4"
  | "chart-5"
  | "sidebar"
  | "sidebar-foreground"
  | "sidebar-primary"
  | "sidebar-primary-foreground"
  | "sidebar-accent"
  | "sidebar-accent-foreground"
  | "sidebar-border"
  | "sidebar-ring"
  | "surface"
  | "answer"
  | "track"
  | "primary-tint"
  | "primary-ink"
  | "attention"
  | "attention-tint"
  | "good"
  | "good-foreground"
  | "again"
  | "again-tint"
  | "again-ink"
  | "hard"
  | "hard-tint"
  | "hard-ink"
  | "easy"
  | "easy-tint"
  | "easy-ink",
  Hex
>;

const AA = 4.5;
const WHITE: Hex = "#ffffff";
const BLACK: Hex = "#000000";
/** Text on light grounds, and ink on light fills: a near-black with a touch of lilac. */
const INK_ON_LIGHT: Hex = "#16131d";
const INK_ON_FILL: Hex = "#120d1c";
/** Delete and Remove aren't themeable, so a recolored Again never looks like deleting. */
const DESTRUCTIVE = { light: "#c62828", dark: "#ff6b6b" } as const satisfies Record<ThemeMode, Hex>;

/** Reads `#rrggbb` in any case, with or without the `#`. */
export const toHex = (text: string): Hex | undefined => {
  const match = /^#?([0-9a-f]{6})$/i.exec(text.trim());
  return match ? `#${match[1]!.toLowerCase()}` : undefined;
};

type Rgb = [number, number, number];

const each = ([r, g, b]: Rgb, f: (v: number, i: number) => number): Rgb => [
  f(r, 0),
  f(g, 1),
  f(b, 2),
];
const byte = (hex: Hex, i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
const toRgb = (hex: Hex): Rgb => [byte(hex, 0), byte(hex, 1), byte(hex, 2)];
const fromRgb = (rgb: Rgb): Hex =>
  `#${rgb
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
const linear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const gamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

const luminance = (hex: Hex) => {
  const [r, g, b] = each(toRgb(hex), linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG 2 contrast ratio, 1 to 21. */
export const contrast = (a: Hex, b: Hex): number => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/** Where white and black text read equally well. Darker than this is a dark ground. */
const isDark = (ground: Hex) => luminance(ground) < 0.179;

type Oklch = [l: number, c: number, h: number];

const toOklch = (hex: Hex): Oklch => {
  const [r, g, b] = each(toRgb(hex), linear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
};

/** Linear sRGB for an OKLCH color, or undefined outside sRGB. */
const inGamut = (L: number, c: number, H: number): Rgb | undefined => {
  const A = c * Math.cos(H);
  const B = c * Math.sin(H);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const rgb: Rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return rgb.every((v) => v >= -1e-4 && v <= 1.0001) ? rgb : undefined;
};

/**
 * Back to sRGB, dropping chroma in steps of 0.002 until the color fits. The steps are searched
 * by halves: at a given lightness and hue, sRGB holds every chroma up to its edge.
 */
const fromOklch = ([L, C, H]: Oklch): Hex => {
  const fits = (k: number) => inGamut(L, C - 0.002 * k, H);
  let rgb = fits(0);
  if (!rgb) {
    let [out, last] = [0, Math.floor(C / 0.002)];
    if (fits(last)) {
      while (last - out > 1) {
        const mid = (out + last) >> 1;
        if (fits(mid)) last = mid;
        else out = mid;
      }
      rgb = fits(last);
    }
  }
  return rgb ? fromRgb(each(rgb, (v) => gamma(Math.min(1, Math.max(0, v))))) : fromRgb([L, L, L]);
};

/** OKLab distance, for "these two look alike". */
const distance = (a: Hex, b: Hex) => {
  const [l1, c1, h1] = toOklch(a);
  const [l2, c2, h2] = toOklch(b);
  return Math.hypot(
    l1 - l2,
    c1 * Math.cos(h1) - c2 * Math.cos(h2),
    c1 * Math.sin(h1) - c2 * Math.sin(h2),
  );
};

/** `t` of the way from `a` to `b`, in sRGB. */
const mix = (a: Hex, b: Hex, t: number): Hex => {
  const [p, q] = [toRgb(a), toRgb(b)];
  return fromRgb(each(p, (v, i) => v * (1 - t) + q[i]! * t));
};

/**
 * `color` as text on every one of `grounds`: moved only in OKLCH lightness, hue kept and chroma
 * at least 0.12 on light grounds, until it reaches AA. It lightens on a dark first ground and
 * deepens on a light one, unless only the other way can read. Undefined when no lightness reads
 * on all of them (white and black are the furthest any color gets).
 */
const readableOn = (color: Hex, ...grounds: [Hex, ...Hex[]]): Hex | undefined => {
  const reads = (x: Hex) => grounds.every((ground) => contrast(x, ground) >= AA);
  if (reads(color)) return color;
  const ends = isDark(grounds[0]) ? [WHITE, BLACK] : [BLACK, WHITE];
  const end = ends.find(reads);
  if (!end) return undefined;
  const lighten = end === WHITE;
  const [L, C0, H] = toOklch(color);
  const C = lighten || C0 < 0.03 ? C0 : Math.max(C0, 0.12);
  // Lightness steps of 0.005, checked ten at a time and then one by one back from the first hit.
  const steps = Math.floor((lighten ? 1 - L : L) / 0.005);
  const at = (i: number) => fromOklch([L + (lighten ? 0.005 : -0.005) * i, C, H]);
  for (let coarse = 10; coarse < steps + 10; coarse += 10) {
    if (!reads(at(Math.min(coarse, steps)))) continue;
    for (let i = coarse - 9; i <= steps; i++) if (reads(at(i))) return at(i);
  }
  return end;
};

/** `color` as text on one ground. White or black always reads, so this always succeeds. */
const readable = (color: Hex, ground: Hex): Hex =>
  readableOn(color, ground) ?? (isDark(ground) ? WHITE : BLACK);

/** The ink on a solid fill. */
const inkOn = (fill: Hex): Hex =>
  [WHITE, INK_ON_FILL].find((ink) => contrast(ink, fill) >= AA) ?? (isDark(fill) ? WHITE : BLACK);

/**
 * Attention reads on its own tint (chips) and on the ground. On a mid ground no ink reads on
 * both, so the tint moves toward the ground until one does.
 */
const chip = (color: Hex, background: Hex, t: number) => {
  for (; t < 1; t += 0.02) {
    const attentionTint = mix(color, background, t);
    const attention = readableOn(color, attentionTint, background);
    if (attention) return { attention, attentionTint };
  }
  return { attention: readable(color, background), attentionTint: background };
};

/** Every token for `mode`, from the user's choice. The factory choice gives `tokens.css`. */
export const themeFor = (choice: ThemeChoice, mode: ThemeMode): Theme => {
  const background = mode === "dark" ? choice.darkBackground : choice.lightBackground;
  const dark = isDark(background);
  const foreground = dark ? WHITE : contrast(INK_ON_LIGHT, background) >= AA ? INK_ON_LIGHT : BLACK;
  const quiet = (t: number) => mix(foreground, background, t);
  // Solid fills: as chosen on dark; on light, deepened until white ink reads on them.
  const fill = (color: Hex) => (dark ? color : readable(color, WHITE));

  // A step toward the text; on mid grounds, where that would cost AA, a step away from it.
  const raised = quiet(dark ? 0.89 : 0.95);
  const surface =
    contrast(foreground, raised) >= AA ? raised : mix(background, dark ? BLACK : WHITE, 0.11);
  const border = quiet(dark ? 0.84 : 0.88);
  const primary = fill(choice.primary);
  const primaryInk = readable(choice.primary, background);
  const primaryTint = mix(choice.primary, background, dark ? 0.8 : 0.82);
  const good = fill(choice.good === "primary" ? choice.primary : choice.good);
  const { attention, attentionTint } = chip(choice.secondary, background, dark ? 0.82 : 0.8);
  const grade = (color: Hex) => {
    const tint = mix(color, background, 0.8);
    return { color: readable(color, tint), tint, ink: readable(color, background) };
  };
  const again = grade(choice.again);
  const hard = grade(choice.hard);
  const easy = grade(choice.easy);

  return {
    background,
    foreground,
    card: background,
    "card-foreground": foreground,
    popover: dark ? surface : background,
    "popover-foreground": foreground,
    primary,
    "primary-foreground": inkOn(primary),
    secondary: surface,
    "secondary-foreground": foreground,
    muted: surface,
    "muted-foreground": readable(quiet(0.45), background),
    accent: primaryTint,
    "accent-foreground": foreground,
    destructive: readable(DESTRUCTIVE[mode], background),
    border,
    input: border,
    ring: primary,
    "chart-1": again.ink,
    "chart-2": hard.ink,
    "chart-3": primaryInk,
    "chart-4": easy.ink,
    "chart-5": attention,
    sidebar: background,
    "sidebar-foreground": foreground,
    "sidebar-primary": primary,
    "sidebar-primary-foreground": inkOn(primary),
    "sidebar-accent": primaryTint,
    "sidebar-accent-foreground": foreground,
    "sidebar-border": border,
    "sidebar-ring": primary,
    surface,
    answer: readable(quiet(0.16), background),
    track: quiet(dark ? 0.8 : 0.86),
    "primary-tint": primaryTint,
    "primary-ink": primaryInk,
    attention,
    "attention-tint": attentionTint,
    good,
    "good-foreground": inkOn(good),
    again: again.color,
    "again-tint": again.tint,
    "again-ink": again.ink,
    hard: hard.color,
    "hard-tint": hard.tint,
    "hard-ink": hard.ink,
    easy: easy.color,
    "easy-tint": easy.tint,
    "easy-ink": easy.ink,
  };
};

/** The colors that must stay apart: the grades, the primary and the secondary. */
const DISTINCT = ["again", "hard", "good", "easy", "primary", "secondary"] as const;

/** Pairs closer than 0.09 in OKLab, in `DISTINCT`'s order. A warning, never a block. */
export const lookAlikes = (choice: ThemeChoice): [ThemeField, ThemeField][] => {
  const colorOf = (field: (typeof DISTINCT)[number]) => {
    const value = choice[field];
    return value === "primary" ? undefined : value;
  };
  return DISTINCT.flatMap((a, i) =>
    DISTINCT.slice(i + 1).flatMap((b): [ThemeField, ThemeField][] => {
      const [x, y] = [colorOf(a), colorOf(b)];
      return x && y && distance(x, y) < 0.09 ? [[a, b]] : [];
    }),
  );
};

/** A choice read back from storage or sync: a missing or broken field keeps its factory color. */
export const parseThemeChoice = (value: unknown): ThemeChoice => {
  const fields: Partial<Record<string, unknown>> =
    typeof value === "object" && value !== null ? value : {};
  const read = (field: ThemeField): Hex | undefined => {
    const raw = fields[field];
    return typeof raw === "string" ? toHex(raw) : undefined;
  };
  return {
    lightBackground: read("lightBackground") ?? FACTORY_THEME.lightBackground,
    darkBackground: read("darkBackground") ?? FACTORY_THEME.darkBackground,
    primary: read("primary") ?? FACTORY_THEME.primary,
    secondary: read("secondary") ?? FACTORY_THEME.secondary,
    again: read("again") ?? FACTORY_THEME.again,
    hard: read("hard") ?? FACTORY_THEME.hard,
    good: fields["good"] === "primary" ? "primary" : (read("good") ?? FACTORY_THEME.good),
    easy: read("easy") ?? FACTORY_THEME.easy,
  };
};

/** Stable indices shared by the generated Android resources and the native preference. */
export const nativeAppearance = (choice: ThemeChoice) => {
  const nearest = (field: "lightBackground" | "darkBackground" | "primary" | "secondary") => {
    const colors = THEME_SWATCHES[field];
    return colors.reduce(
      (best, color, i) =>
        distance(choice[field], color) < distance(choice[field], colors[best]!) ? i : best,
      0,
    );
  };
  return {
    light: nearest("lightBackground"),
    dark: nearest("darkBackground"),
    primary: nearest("primary"),
    secondary: nearest("secondary"),
  };
};
