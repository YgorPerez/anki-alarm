import { defineConfig } from "@playwright/test";

import { E2E } from "./e2e/servers.ts";

// The real system: the web's production build on the Cloudflare preview, and the sync Worker in
// `wrangler dev` on a fresh local D1, with dev sign-in instead of Google (apps/sync/src/auth.ts).
const vars = {
  BETTER_AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-0123456",
  BETTER_AUTH_URL: E2E.sync,
  TRUSTED_ORIGINS: E2E.web,
  GOOGLE_CLIENT_ID: "dev",
  GOOGLE_CLIENT_SECRET: "dev",
  DEV_SIGN_IN: "1",
};
const state = ".wrangler/e2e";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: { baseURL: E2E.web, headless: true },
  webServer: [
    {
      cwd: "../sync",
      command: [
        `rm -rf ${state}`,
        `pnpm exec wrangler d1 migrations apply app-sync --local --persist-to ${state}`,
        `pnpm exec wrangler dev --port 8787 --persist-to ${state} ${Object.entries(vars)
          .map(([name, value]) => `--var ${name}:${value}`)
          .join(" ")}`,
      ].join(" && "),
      url: `${E2E.sync}/health`,
      timeout: 120_000,
    },
    {
      command: "pnpm build && pnpm exec vp preview --port 4173",
      env: { VITE_SYNC_URL: E2E.sync, VITE_DEV_SIGN_IN: "1" },
      port: 4173,
      timeout: 180_000,
    },
  ],
});
