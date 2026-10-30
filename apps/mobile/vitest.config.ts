import babel from "@rolldown/plugin-babel";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

// Resolved from this package: Babel would look for the bare name from the workspace root, where a
// clean install doesn't hoist it.
const reactCompiler = createRequire(import.meta.url).resolve("babel-plugin-react-compiler");

const standIn = (file: string) => fileURLToPath(new URL(`./test/native/${file}`, import.meta.url));

// Unit tests, and screen tests with React Native Testing Library. React Native and the native
// modules the screens reach are swapped for the stand-ins in test/native. The screens run through
// React Compiler, as babel-preset-expo runs them on the phone.
export default defineConfig({
  plugins: [babel({ include: /\/src\/.*\.tsx$/, plugins: [reactCompiler] })],
  resolve: {
    // Exact names: `expo-file-system/legacy` is not stood in.
    alias: [
      ["react-native-webview", "webview.ts"],
      ["react-native-svg", "svg.ts"],
      ["react-native", "react-native.ts"],
      ["react-native-safe-area-context", "safe-area-context.ts"],
      ["expo-sqlite", "expo-sqlite.ts"],
      ["expo-crypto", "expo-crypto.ts"],
      ["expo-file-system", "expo-file-system.ts"],
      ["@react-native-community/datetimepicker", "datetimepicker.ts"],
    ].map(([name, file]) => ({ find: new RegExp(`^${name}$`), replacement: standIn(file!) })),
  },
  test: {
    name: "mobile",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./test/setup.ts"],
    // TanStack Charts goes through Vite so its react-native and react-native-svg imports reach
    // the stand-ins.
    server: { deps: { inline: [/@tanstack\/charts/] } },
  },
});
