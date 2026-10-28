# Sharing design tokens between react-native-reusables (uniwind) and shadcn (web)

Research for ticket #31. Sources were read at these commits (all links below are permalinks):

- uniwind `4c6949b` (v1.13.1): `U` = https://github.com/uni-stack/uniwind/blob/4c6949b2e8c68ccff127673498d029e2bdde46c9
- react-native-reusables `385834c`: `R` = https://github.com/founded-labs/react-native-reusables/blob/385834c2196f8a303cbc9057d1ac768f3bde0a3b
- react-native-reusables-templates `ecdc14b`: `RT` = https://github.com/founded-labs/react-native-reusables-templates/blob/ecdc14b50fa9ad4d905085dc394cf783d48ad66d
- shadcn-ui/ui `96da9cc`: `S` = https://github.com/shadcn-ui/ui/blob/96da9cc7f1aa10580a3741664e2a77c721206c00
- t3code `5211acf`: `T` = https://github.com/pingdotgg/t3code/blob/5211acfe95a0c6d82a60e2524b5e46b47fe67a3e

## Answer

Write the tokens once, in uniwind's shape, in a workspace package. The web gets a small adapter
from the same package.

```text
packages/design-tokens/            name: @app/design-tokens (the spec's working scope)
  package.json                     exports "./tokens.css" and "./web.css", no JS
  tokens.css                       THE values: colors per theme, radius, type scale
  web.css                          web-only adapter, no values (variants, registration, aliases)
  tokens.test.ts                   parity checks (see below)
```

**`tokens.css`** (imported by both apps):

```css
@layer theme {
  :root {
    @variant light {
      --color-background: oklch(1 0 0);
      --color-foreground: oklch(0.145 0 0);
      --color-primary: oklch(0.205 0 0);
      --color-primary-foreground: oklch(0.985 0 0);
      /* … the shadcn set: card, popover, secondary, muted, accent, destructive,
         border, input, ring, chart-1…5, sidebar-*; plus our own (e.g. success) */
    }
    @variant dark {
      /* exactly the same names */
    }
  }
}

@theme {
  --radius-sm: 6px; --radius-md: 8px; --radius-lg: 10px; --radius-xl: 14px;
  /* type sizes, spacing extras: plain values, no platform variants */
}
```

**`web.css`** (imported by the web only, after `tokens.css`):

```css
/* The same variants uniwind generates for itself: a .light/.dark class on <html> wins,
   otherwise the OS setting. */
@custom-variant dark {
  &:where(.dark, .dark *) { @slot; }
  @media (prefers-color-scheme: dark) {
    &:not(:where(.light, .light *, .dark, .dark *)) { @slot; }
  }
}
@custom-variant light {
  &:where(.light, .light *) { @slot; }
  @media (prefers-color-scheme: light) {
    &:not(:where(.light, .light *, .dark, .dark *)) { @slot; }
  }
}

/* Register the names with Tailwind so bg-background etc. exist (uniwind does this itself
   on native). */
@theme {
  --color-background: unset;
  --color-foreground: unset;
  /* … one line per color token */
}

/* shadcn's own names, for the few base-nova components that read var(--primary) directly. */
:root {
  --background: var(--color-background);
  --primary: var(--color-primary);
  --radius: var(--radius-lg);
  /* … one line per color token */
}
```

**Phone** (`apps/mobile/global.css`, the `cssEntryFile`):

```css
@import "tailwindcss";
@import "uniwind";
@import "@app/design-tokens/tokens.css";
@theme { --font-sans: "<LoadedFontFileName>"; }   /* fonts stay per app */
```

Light/dark: uniwind follows the system by default; `Uniwind.setTheme('light' | 'dark' | 'system')`
for the user's choice. No provider. React Navigation colors come from
`useCSSVariable('--color-background')` etc., not from a second hard-coded `lib/theme.ts`.

**Web** (`apps/web/src/styles.css`, the file `components.json` → `tailwind.css` points to):

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
@import "@app/design-tokens/tokens.css";
@import "@app/design-tokens/web.css";
@theme { --font-sans: "…", system-ui, sans-serif; }
```

Light/dark: shadcn's TanStack Start `ThemeProvider` (a `ScriptOnce` that puts `light` or `dark` on
`<html>` before hydration). With no class, the OS setting applies, so the two apps behave the same.

**Constraints the design grilling must respect:**

1. Color names are `--color-<name>` (uniwind's naming), and each one exists in both `light` and
   `dark`. The utility class names are then the shadcn ones on both sides (`bg-background`,
   `text-primary-foreground`, `border-border`, `ring-ring`). Do not use shadcn's
   `--background` + `@theme inline` shape as the source: uniwind has a known bug with it on
   opacity modifiers (`bg-primary/90`), which shadcn and react-native-reusables components use
   everywhere.
2. Values: oklch (or hex/rgb/hsl) literals. Keep colors inside sRGB: the phone converts every color
   to hex at build time. No relative color syntax (`oklch(from …)`), no `var()` between tokens, no
   uniwind-only functions (`hairlineWidth()`), no platform variants (`android`, `native`) in the
   shared files: plain Tailwind on the web doesn't define them.
3. Only the `light` and `dark` themes. More themes need `extraThemes` on the phone and new variants
   on the web.
4. Fonts and anything platform-specific stay in each app's CSS: React Native takes one font file
   name per family, the web takes a stack.
5. The shadcn CLI writes `:root {}` / `.dark {}` blocks and `@theme inline` mappings when you run
   `init` or add some components (sidebar, chart). Port any new variable into `tokens.css` and
   `web.css` and delete what the CLI wrote. Keep the `@custom-variant dark` line in `web.css` so
   the CLI doesn't add its own `(&:is(.dark *))`, which breaks the shared file.
6. `tokens.test.ts` checks that light and dark have the same names, that `web.css` registers and
   aliases exactly those names, and (once `DESIGN.md` exists) that the values match its YAML header,
   as pesquisa-relacionamentos does.

## Detail

### Where the tokens live

shadcn's own monorepo templates already put the CSS in a workspace package and point the app at it:
`packages/ui` exports `"./globals.css"`
([S/templates/start-monorepo/packages/ui/package.json](https://github.com/shadcn-ui/ui/blob/96da9cc7f1aa10580a3741664e2a77c721206c00/templates/start-monorepo/packages/ui/package.json)),
and the web app's `components.json` sets `"css": "../../packages/ui/src/styles/globals.css"`
([S/templates/start-monorepo/apps/web/components.json#L8](https://github.com/shadcn-ui/ui/blob/96da9cc7f1aa10580a3741664e2a77c721206c00/templates/start-monorepo/apps/web/components.json#L8)).
We can't copy that file as is: it is the shadcn shape (`:root`, `.dark`, `@theme inline`), which
the phone can't read correctly (next section).

uniwind follows CSS imports when it collects theme variables. It reads relative imports by path
and resolves package imports through Tailwind's compiler, skipping only tailwindcss and uniwind
themselves
([U/…/bundler/artifacts/css/themes.ts#L16-L21](https://github.com/uni-stack/uniwind/blob/4c6949b2e8c68ccff127673498d029e2bdde46c9/packages/uniwind/src/bundler/artifacts/css/themes.ts#L16-L21),
[#L75-L105](https://github.com/uni-stack/uniwind/blob/4c6949b2e8c68ccff127673498d029e2bdde46c9/packages/uniwind/src/bundler/artifacts/css/themes.ts#L75-L105)).
So an `@import` of the package's `tokens.css` from `global.css` is read. The tokens file has no
class names, so no `@source` is needed for it (uniwind's `@source` advice for monorepos is about
packages that contain classes:
[U/skills/uniwind/references/setup.md#L133-L144](https://github.com/uni-stack/uniwind/blob/4c6949b2e8c68ccff127673498d029e2bdde46c9/skills/uniwind/references/setup.md#L133-L144)).

### How uniwind reads themes

- Themes are declared as `@layer theme { :root { @variant light {…} @variant dark {…} } }`
  ([U/skills/uniwind/references/theming.md#L15-L56](https://github.com/uni-stack/uniwind/blob/4c6949b2e8c68ccff127673498d029e2bdde46c9/skills/uniwind/references/theming.md#L15-L56);
  docs: https://docs.uniwind.dev/theming/global-css). The bundler only treats a `:root` rule as
  theme variables inside `@layer theme`
  ([U/…/css-visitor/rule-visitor.ts#L26-L34](https://github.com/uni-stack/uniwind/blob/4c6949b2e8c68ccff127673498d029e2bdde46c9/packages/uniwind/src/bundler/css-visitor/rule-visitor.ts#L26-L34)),
  and only collects names found inside `@variant <theme>` blocks
  ([themes.ts#L47-L66](https://github.com/uni-stack/uniwind/blob/4c6949b2e8c68ccff127673498d029e2bdde46c9/packages/uniwind/src/bundler/artifacts/css/themes.ts#L47-L66)).
  The maintainers reject other shapes (a bare `@variant` without `:root`): "Please use suggested
  syntax" ([uniwind#669](https://github.com/uni-stack/uniwind/issues/669)).
- A plain `.dark { … }` rule, shadcn's default, is not a theme on native: a class selector is only
  scoped to a theme when its name has a `dark:` prefix
  ([rule-visitor.ts#L116-L127](https://github.com/uni-stack/uniwind/blob/4c6949b2e8c68ccff127673498d029e2bdde46c9/packages/uniwind/src/bundler/css-visitor/rule-visitor.ts#L117-L127)).
- Every theme must declare the same names, or the build logs "Theme X is missing variable Y"
  ([themes.ts#L110-L127](https://github.com/uni-stack/uniwind/blob/4c6949b2e8c68ccff127673498d029e2bdde46c9/packages/uniwind/src/bundler/artifacts/css/themes.ts#L110-L127);
  [SKILL.md#L38](https://github.com/uni-stack/uniwind/blob/4c6949b2e8c68ccff127673498d029e2bdde46c9/skills/uniwind/SKILL.md#L38)).
  That is why light values can't sit in a bare `:root` with only dark in a variant.
- uniwind then generates, for Tailwind, `@theme { <name>: unset; }` for every collected name, plus
  the `light`/`dark` custom variants (class `.light`/`.dark`, otherwise `prefers-color-scheme`)
  ([themes.ts#L129-L161](https://github.com/uni-stack/uniwind/blob/4c6949b2e8c68ccff127673498d029e2bdde46c9/packages/uniwind/src/bundler/artifacts/css/themes.ts#L129-L161)).
  `--color-background` in a variant therefore becomes `bg-background`
  ([theming.md#L56](https://github.com/uni-stack/uniwind/blob/4c6949b2e8c68ccff127673498d029e2bdde46c9/skills/uniwind/references/theming.md#L56)).
  `web.css` above copies those generated variants and registration so the web compiles the
  shared file the same way uniwind's own web target does.
- At runtime `var(--x)` is a lookup in the current theme's variables, whatever the name
  ([U/…/css-processor/var.ts#L7-L8](https://github.com/uni-stack/uniwind/blob/4c6949b2e8c68ccff127673498d029e2bdde46c9/packages/uniwind/src/bundler/css-processor/var.ts#L7-L8),
  [processor.ts#L79-L103](https://github.com/uni-stack/uniwind/blob/4c6949b2e8c68ccff127673498d029e2bdde46c9/packages/uniwind/src/bundler/css-processor/processor.ts#L79-L103)).

### Why `--color-*` and not shadcn's `--background` + `@theme inline`

shadcn's convention is raw `--background` under `:root` and `.dark`, mapped with
`@theme inline { --color-background: var(--background) }`
([S/apps/v4/content/docs/(root)/theming.mdx#L37](https://github.com/shadcn-ui/ui/blob/96da9cc7f1aa10580a3741664e2a77c721206c00/apps/v4/content/docs/(root)/theming.mdx#L37),
[#L118-L130](https://github.com/shadcn-ui/ui/blob/96da9cc7f1aa10580a3741664e2a77c721206c00/apps/v4/content/docs/(root)/theming.mdx#L118-L130);
[monorepo globals.css#L6-L120](https://github.com/shadcn-ui/ui/blob/96da9cc7f1aa10580a3741664e2a77c721206c00/templates/react-router-monorepo/packages/ui/src/styles/globals.css#L6-L120)).
Put inside uniwind variants, that shape breaks opacity modifiers: `bg-primary/12` compiles to
`color-mix(… unset 12% …)` on web and native, because uniwind registers `--primary: unset` and
Tailwind inlines that into the fallback ([uniwind#705](https://github.com/uni-stack/uniwind/issues/705),
closed 2026-10-02 by the template bot, not by a fix; the `unset` line is still in
[themes.ts#L129-L136](https://github.com/uni-stack/uniwind/blob/4c6949b2e8c68ccff127673498d029e2bdde46c9/packages/uniwind/src/bundler/artifacts/css/themes.ts#L129-L136)).
Both component sets use opacity modifiers a lot: in the uniwind react-native-reusables registry,
`bg-primary/90`, `bg-destructive/10`, `ring-ring/50`, `dark:bg-input/30` and others
([R/packages/registry/src/uniwind](https://github.com/founded-labs/react-native-reusables/tree/385834c2196f8a303cbc9057d1ac768f3bde0a3b/packages/registry/src/uniwind)).

The `--color-*`-in-variants shape is what the official react-native-reusables uniwind template
ships, with exactly shadcn's token set and oklch values
([RT/minimal-uniwind/global.css#L1-L86](https://github.com/founded-labs/react-native-reusables-templates/blob/ecdc14b50fa9ad4d905085dc394cf783d48ad66d/minimal-uniwind/global.css#L1-L86);
the CLI offers this template as "Minimal (Uniwind)":
[R/apps/cli/src/project-manifest.ts#L344-L346](https://github.com/founded-labs/react-native-reusables/blob/385834c2196f8a303cbc9057d1ac768f3bde0a3b/apps/cli/src/project-manifest.ts#L344-L346)).
uniwind's own test fixture uses it too, including a manual `--color-background: unset` in `@theme`
next to the variants ([U/packages/uniwind/tests/test.css#L10-L31](https://github.com/uni-stack/uniwind/blob/4c6949b2e8c68ccff127673498d029e2bdde46c9/packages/uniwind/tests/test.css#L10-L31)).
The class names come out the same as shadcn's, so components on both sides use the same classes.

What the web loses is shadcn's raw names. A few base-nova pieces read them directly:
`sonner.tsx` uses `var(--popover)`, `var(--border)`, `var(--radius)`
([S/apps/v4/registry/bases/base/ui/sonner.tsx#L69-L72](https://github.com/shadcn-ui/ui/blob/96da9cc7f1aa10580a3741664e2a77c721206c00/apps/v4/registry/bases/base/ui/sonner.tsx#L69-L72)),
and the nova style uses `var(--secondary)`, `var(--foreground)`, `var(--sidebar-border)`, `var(--radius-md)`
([S/apps/v4/registry/styles/style-nova.css#L162](https://github.com/shadcn-ui/ui/blob/96da9cc7f1aa10580a3741664e2a77c721206c00/apps/v4/registry/styles/style-nova.css#L162),
[#L1179](https://github.com/shadcn-ui/ui/blob/96da9cc7f1aa10580a3741664e2a77c721206c00/apps/v4/registry/styles/style-nova.css#L1179)).
The alias block in `web.css` covers them. The uniwind react-native-reusables components don't read
raw token variables (the only `var(--` in that registry is a Radix size on web,
[R/…/uniwind/components/ui/select.tsx#L122](https://github.com/founded-labs/react-native-reusables/blob/385834c2196f8a303cbc9057d1ac768f3bde0a3b/packages/registry/src/uniwind/components/ui/select.tsx#L122)),
so the phone needs no aliases.

### Light and dark on each side

**Phone.** The themes are `light` and `dark`. The default is the device color scheme and follows
its changes; `Uniwind.setTheme('light' | 'dark')` pins one and also calls
`Appearance.setColorScheme`, and `setTheme('system')` goes back to following the device
([U/…/core/config/config.common.ts#L23-L108](https://github.com/uni-stack/uniwind/blob/4c6949b2e8c68ccff127673498d029e2bdde46c9/packages/uniwind/src/core/config/config.common.ts#L23-L108);
https://docs.uniwind.dev/theming/basics). No provider is needed
([SKILL.md#L34](https://github.com/uni-stack/uniwind/blob/4c6949b2e8c68ccff127673498d029e2bdde46c9/skills/uniwind/SKILL.md#L34)).
`useUniwind()` gives `theme` and `hasAdaptiveThemes` for a settings toggle
([theming.md#L98-L118](https://github.com/uni-stack/uniwind/blob/4c6949b2e8c68ccff127673498d029e2bdde46c9/skills/uniwind/references/theming.md#L98-L118)).

The react-native-reusables template keeps a second copy of the palette in `lib/theme.ts` (in hsl,
for React Navigation's `ThemeProvider`)
([RT/minimal-uniwind/lib/theme.ts#L3-L81](https://github.com/founded-labs/react-native-reusables-templates/blob/ecdc14b50fa9ad4d905085dc394cf783d48ad66d/minimal-uniwind/lib/theme.ts#L3-L81)).
Drop it and read the CSS instead: `useCSSVariable(['--color-background', …])` is reactive to the
theme, `Uniwind.getCSSVariable` reads once outside React
([theming.md#L234-L266](https://github.com/uni-stack/uniwind/blob/4c6949b2e8c68ccff127673498d029e2bdde46c9/skills/uniwind/references/theming.md#L234-L266)).
Those only see variables used in a `className` or declared in `@theme static`; the shadcn colors
are all used by the components.

**Web.** Tailwind's `dark` variant defaults to `prefers-color-scheme` and is overridden with
`@custom-variant` (https://tailwindcss.com/docs/dark-mode#toggling-dark-mode-manually). Tailwind
has no `light` variant, so `web.css` defines both, with uniwind's definitions. shadcn's TanStack
Start dark-mode guide adds `light` or `dark` to `<html>` from a `ScriptOnce` before hydration and
on change
([S/apps/v4/content/docs/dark-mode/tanstack-start.mdx#L29-L53](https://github.com/shadcn-ui/ui/blob/96da9cc7f1aa10580a3741664e2a77c721206c00/apps/v4/content/docs/dark-mode/tanstack-start.mdx#L29-L53),
[#L95](https://github.com/shadcn-ui/ui/blob/96da9cc7f1aa10580a3741664e2a77c721206c00/apps/v4/content/docs/dark-mode/tanstack-start.mdx#L95)),
which matches those variants. shadcn components' own `dark:` classes use the same variant.

Don't use shadcn's default `@custom-variant dark (&:is(.dark *))`. It matches descendants of
`.dark` only, so `:root { @variant dark {…} }` would never match `<html class="dark">`. Tailwind's
documented `(&:where(.dark, .dark *))` and uniwind's definition both match the element itself. The
shadcn CLI adds its line only when the CSS file has no `@custom-variant` at all
([S/packages/registry/src/updaters/update-css-vars.ts#L91-L94](https://github.com/shadcn-ui/ui/blob/96da9cc7f1aa10580a3741664e2a77c721206c00/packages/registry/src/updaters/update-css-vars.ts#L91-L94),
[#L513-L540](https://github.com/shadcn-ui/ui/blob/96da9cc7f1aa10580a3741664e2a77c721206c00/packages/registry/src/updaters/update-css-vars.ts#L513-L540)).
It does write `:root {}` and `.<theme> {}` blocks for a registry item's `cssVars`
([#L288-L298](https://github.com/shadcn-ui/ui/blob/96da9cc7f1aa10580a3741664e2a77c721206c00/packages/registry/src/updaters/update-css-vars.ts#L288-L298)).
Those would be unlayered, so they'd beat the tokens in `@layer theme`. Hence constraint 5.

### Color formats on the phone

uniwind converts colors at build time with culori and emits hex (`#rrggbb`, or `#rrggbbaa` with
alpha) ([U/…/css-processor/color.ts#L17-L85](https://github.com/uni-stack/uniwind/blob/4c6949b2e8c68ccff127673498d029e2bdde46c9/packages/uniwind/src/bundler/css-processor/color.ts#L17-L85)).
Accepted color functions: `rgb`, `oklab`, `oklch`, `hsl`, `hwb`, `lab`, `lch`, `srgb`
([functions.ts#L88-L103](https://github.com/uni-stack/uniwind/blob/4c6949b2e8c68ccff127673498d029e2bdde46c9/packages/uniwind/src/bundler/css-processor/functions.ts#L88-L103)),
`color(display-p3 …)` ([theming.md#L314-L331](https://github.com/uni-stack/uniwind/blob/4c6949b2e8c68ccff127673498d029e2bdde46c9/skills/uniwind/references/theming.md#L314-L331)),
and `color-mix()`, resolved at runtime when it involves variables
([functions.ts#L84-L86](https://github.com/uni-stack/uniwind/blob/4c6949b2e8c68ccff127673498d029e2bdde46c9/packages/uniwind/src/bundler/css-processor/functions.ts#L84-L86)).
oklch is documented and used in the react-native-reusables template
([theming.md#L295-L312](https://github.com/uni-stack/uniwind/blob/4c6949b2e8c68ccff127673498d029e2bdde46c9/skills/uniwind/references/theming.md#L295-L312)).
Because the phone ends in sRGB hex while browsers render oklch directly, a color outside sRGB
can look different on the two. Keep tokens in sRGB.

### Prior art in the user's projects

**pesquisa-relacionamentos** (read at `6711c4a`, a local clone of `YgorPerez/pesquisa-relacionamentos`):
web only, `base-nova`, light only. `DESIGN.md`'s YAML header is the source of truth.
`frontend/src/ui/tokens.css` is a hand-written `@theme static` with project names (`--color-papel`,
`--radius-mao`), and Tailwind's default scales are dropped with `initial`. `tokens.test.ts` parses
the YAML and checks every value against the CSS (ADR 0026). The shadcn components were redrawn on
those tokens instead of `--primary` & co. (ADR 0027), so it has no shadcn semantic tokens and no
dark mode. Two things to reuse: `DESIGN.md` YAML as the source, with a test that keeps the CSS in
step; and dropping unused Tailwind scales so the lint catches stray `bg-red-500`.

**t3code** has no source checkout on this machine (only the installed AppImage), so I read the
public repo. It has both apps: Expo + uniwind in `apps/mobile` and Tailwind 4 in `apps/web`.

- The palette is TypeScript data in a shared package
  ([T/packages/shared/src/themePalettes.ts#L1-L80](https://github.com/pingdotgg/t3code/blob/5211acfe95a0c6d82a60e2524b5e46b47fe67a3e/packages/shared/src/themePalettes.ts#L1-L80)).
- Mobile generates uniwind CSS from it with a script (`pnpm generate`): `--color-*` names inside
  `@layer theme { :root { @variant light/dark … } }`, the same shape recommended here
  ([T/apps/mobile/scripts/generate-uniwind-themes.mts](https://github.com/pingdotgg/t3code/blob/5211acfe95a0c6d82a60e2524b5e46b47fe67a3e/apps/mobile/scripts/generate-uniwind-themes.mts),
  [global.css#L1-L3](https://github.com/pingdotgg/t3code/blob/5211acfe95a0c6d82a60e2524b5e46b47fe67a3e/apps/mobile/global.css#L1-L3),
  [package.json#L47](https://github.com/pingdotgg/t3code/blob/5211acfe95a0c6d82a60e2524b5e46b47fe67a3e/apps/mobile/package.json#L47)).
  Its many named palettes go to `extraThemes`
  ([metro.config.js#L6](https://github.com/pingdotgg/t3code/blob/5211acfe95a0c6d82a60e2524b5e46b47fe67a3e/apps/mobile/metro.config.js#L6)).
- The web keeps shadcn's shape (`--background` + `@theme inline`) and toggles `.dark` on `<html>`.
  It defines `@custom-variant dark (&:is(.dark, .dark *))` and `light (&:not(.dark, .dark *))`,
  and writes `:root { …; @variant dark {…} }`, the same nesting as the shared file here
  ([T/apps/web/src/index.css#L5-L6](https://github.com/pingdotgg/t3code/blob/5211acfe95a0c6d82a60e2524b5e46b47fe67a3e/apps/web/src/index.css#L5-L6),
  [#L275](https://github.com/pingdotgg/t3code/blob/5211acfe95a0c6d82a60e2524b5e46b47fe67a3e/apps/web/src/index.css#L275),
  [#L1113-L1192](https://github.com/pingdotgg/t3code/blob/5211acfe95a0c6d82a60e2524b5e46b47fe67a3e/apps/web/src/index.css#L1113-L1192);
  [useTheme.ts#L337](https://github.com/pingdotgg/t3code/blob/5211acfe95a0c6d82a60e2524b5e46b47fe67a3e/apps/web/src/hooks/useTheme.ts#L337)).

t3code needs codegen because it has user-importable palettes. With two fixed themes, one
hand-written CSS file and a parity test are enough. If the design grilling wants `DESIGN.md` to
be the only place values are typed, generating `tokens.css` from its YAML (t3code's approach) is
the alternative to the test (pesquisa's approach).

### Out of scope here, but touching tokens

- The card WebView (phone) and the card page (web) render Core's HTML with the note type's CSS.
  They don't see uniwind variables. If cards should follow the app theme, the app has to pass the
  resolved colors or the theme name into the rendered document.
- Any UI drawn in Kotlin (`modules/alarm-native`) can't read CSS. It would need colors passed in,
  for example from `Uniwind.getCSSVariable` when the alarm is scheduled.

## Needs checking in a build

1. Android: `@import "@app/design-tokens/tokens.css"` through the pnpm symlink. Check that
   uniwind finds both themes (no "missing variable" errors), and that editing the token file
   reloads in Metro (it lives outside the app dir).
2. Android: `bg-primary/90`, `bg-destructive/10` and `dark:bg-input/30` from react-native-reusables
   render the right colors with this layout (not black or transparent: the #705 class of bug).
3. Web: the `--color-*: unset` registration in `web.css` doesn't override the token values. Check
   the computed `--color-background` on `<html>` with class `light`, class `dark`, and no class
   under OS light and OS dark.
4. Web: the uniwind-style block `@custom-variant light {…}` compiles under plain `@tailwindcss/vite`
   (it is what uniwind feeds Tailwind, but in uniwind's own pipeline).
5. Web: the base-nova pieces that read raw variables (Sonner, nova button hover, sidebar ring)
   render right through the alias block.
6. Phone vs browser: the same oklch token looks the same side by side, for the most saturated
   colors in the final palette.
7. `useCSSVariable('--color-background')` returns the current theme's value for React Navigation's
   theme, and updates on `Uniwind.setTheme`.
