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
  "apps/sync/.wrangler/**",
  "apps/sync/worker-configuration.d.ts",
  // The throwaway prototypes and what Impeccable generates.
  "prototypes/**",
  ".impeccable/**",
];

export default defineConfig({
  test: {
    projects: ["packages/*", "apps/*"],
  },
  fmt: {
    printWidth: 100,
    ignorePatterns: IGNORED,
  },
  lint: {
    ignorePatterns: IGNORED,
    plugins: ["eslint", "typescript", "unicorn", "oxc", "react", "import", "vitest"],
    categories: { correctness: "error" },
    options: {
      typeAware: true,
      typeCheck: true,
      denyWarnings: true,
      reportUnusedDisableDirectives: "deny",
    },
    jsPlugins: [
      // `vite-plus/prefer-vite-plus-imports`: Vite and Vitest come from Vite+.
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
    ],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      "react/rules-of-hooks": "error",
      "react/exhaustive-deps": "error",
    },
  },
});
