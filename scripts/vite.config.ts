import { defineConfig } from "vite-plus";

export default defineConfig({
  test: { name: "release-scripts", include: ["release/*.test.ts", "tooling/*.test.ts"] },
});
