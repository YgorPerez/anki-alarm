import { defineConfig } from "vite-plus";
import tailwindcss from "@tailwindcss/vite";
import { react } from "../react.ts";
export default defineConfig({ plugins: [...react(), tailwindcss()] });
