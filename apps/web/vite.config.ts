import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig } from "vite-plus";

import { react } from "./react.ts";

// Start renders on Cloudflare Workers: the Cloudflare plugin runs the SSR environment in workerd,
// in `vp dev` as in production. Tests and Storybook use vitest.config.ts, without it.
export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart(),
    react(),
  ],
});
