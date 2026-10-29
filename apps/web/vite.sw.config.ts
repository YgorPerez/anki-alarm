import { serwist } from "@serwist/vite";
import { defineConfig } from "vite-plus";

import { SHELL_PAGES } from "./src/shell.ts";

// Run after Start's multi-environment build: all client chunks (including SQLite's Worker/WASM)
// must exist before Serwist collects the manifest. No Cloudflare/SSR plugins run in this build.
export default defineConfig({
  build: {
    outDir: "dist/client",
    emptyOutDir: false,
    lib: { entry: "src/sw.ts", formats: ["iife"], name: "AppShell", fileName: () => "sw.js" },
  },
  plugins: [
    serwist({
      swSrc: "src/sw.ts",
      swDest: "sw.js",
      globDirectory: "dist/client",
      globPatterns: ["**/*.{js,css,wasm,woff2}"],
      maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      additionalPrecacheEntries: SHELL_PAGES.flatMap((page) => [page, `${page}?lang=en`]).map(
        (url) => ({ url, revision: String(Date.now()) }),
      ),
    }),
  ],
});
