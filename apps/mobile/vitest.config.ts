import babel from "@rolldown/plugin-babel";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

const standIn = (file: string) => fileURLToPath(new URL(`./test/native/${file}`, import.meta.url));

// Unit tests, and screen tests with React Native Testing Library. React Native and the native
// modules the screens reach are swapped for the stand-ins in test/native. The screens run through
// React Compiler, as babel-preset-expo runs them on the phone.
export default defineConfig({
  plugins: [babel({ include: /\/src\/.*\.tsx$/, plugins: ["babel-plugin-react-compiler"] })],
  resolve: {
    alias: {
      "react-native-webview": standIn("webview.ts"),
      "react-native": standIn("react-native.ts"),
      "react-native-safe-area-context": standIn("safe-area-context.ts"),
      "expo-sqlite": standIn("expo-sqlite.ts"),
      "expo-crypto": standIn("expo-crypto.ts"),
    },
  },
  test: {
    name: "mobile",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./test/setup.ts"],
  },
});
