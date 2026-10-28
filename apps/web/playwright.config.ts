import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  use: { baseURL: "http://localhost:4173", headless: true },
  webServer: {
    command: "pnpm build && pnpm exec vp preview --port 4173",
    port: 4173,
    timeout: 120_000,
  },
});
