// The root Vite+: format (Oxfmt), lint (Oxlint, with type checks) and the test projects for the
// whole repository. `vp check`, `vp lint`, `vp fmt` and `vp test` read this file even when run
// from a package. Each app keeps its own Vite config for building.
import { defineConfig } from "vite-plus";

/** Not our code, or generated. */
const IGNORED = [
  "**/node_modules/**",
  "**/dist/**",
  "**/coverage/**",
  "apps/mobile/android/**",
  "apps/mobile/.expo/**",
  "apps/mobile/uniwind-types.d.ts",
  "apps/web/.output/**",
  "apps/web/.tanstack/**",
  "apps/web/src/routeTree.gen.ts",
  "apps/*/.wrangler/**",
  "apps/sync/worker-configuration.d.ts",
  // The throwaway prototypes and what Impeccable generates.
  "prototypes/**",
  ".impeccable/**",
];

export default defineConfig({
  test: {
    // Not the web yet: its Vite config runs SSR in workerd, which Vitest can't load. Its first
    // test brings a test config without the Cloudflare plugin. The phone has no Vite config.
    projects: ["packages/*", "apps/sync"],
    // A stray `.only` passes locally and must not pass CI.
    allowOnly: !process.env["CI"],
  },
  // The pre-commit hook (`vp config`, run by `prepare`) formats what's staged.
  staged: {
    "*": "vp fmt --no-error-on-unmatched-pattern",
  },
  fmt: {
    printWidth: 100,
    sortPackageJson: {},
    ignorePatterns: IGNORED,
  },
  lint: {
    ignorePatterns: IGNORED,
    plugins: ["eslint", "typescript", "unicorn", "oxc", "react", "import", "vitest"],
    categories: { correctness: "error", suspicious: "error", perf: "error" },
    options: {
      typeAware: true,
      typeCheck: true,
      denyWarnings: true,
      reportUnusedDisableDirectives: "deny",
    },
    jsPlugins: [
      // `vite-plus/prefer-vite-plus-imports`: Vite and Vitest come from Vite+.
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      // The web's Tailwind classes against the theme (`apps/web/src/styles.css`, which imports
      // `@app/design-tokens`) and its shadcn components (`apps/web/components.json`).
      "@shadcn/lint",
    ],
    settings: {
      shadcn: {
        themeImports: ["^@app/design-tokens/"],
        note: "The tokens are in packages/design-tokens and DESIGN.md explains each one.",
      },
    },
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      "react/rules-of-hooks": "error",
      "react/exhaustive-deps": "error",
      // Both apps use the automatic JSX runtime, which needs no `React` in scope.
      "react/react-in-jsx-scope": "off",
      // expo-status-bar's `style` is a string ("auto", "light", "dark").
      "react/style-prop-object": ["error", { allow: ["StatusBar"] }],
      // A stylesheet is imported for its effect.
      "import/no-unassigned-import": ["error", { allow: ["**/*.css"] }],
    },
    overrides: [
      {
        files: ["apps/web/src/**"],
        excludeFiles: ["apps/web/src/ui/shadcn/**"],
        rules: {
          "shadcn/no-unknown-classes": "error",
          "shadcn/no-raw-colors": "error",
          "shadcn/no-arbitrary-values": "error",
          "shadcn/require-static-classes": "error",
          "shadcn/no-restyle": ["error", { allow: ["layout"] }],
        },
      },
    ],
  },
});
