import { defineConfig } from "vite-plus";

import { react } from "./react.ts";

// Screen tests: Testing Library on jsdom. Not vite.config.ts, whose Cloudflare plugin runs SSR in
// workerd, which Vitest can't load.
export default defineConfig({
  plugins: [react()],
  test: {
    name: "web",
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./test/setup.ts"],
  },
});
