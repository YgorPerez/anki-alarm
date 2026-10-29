/// <reference types="node" />
import { registerHooks } from "node:module";
import { afterEach } from "vite-plus/test";

// React Native Testing Library is CommonJS that Node loads, outside Vite's aliases, so its
// `require("react-native")` is pointed at the stand-in here.
const standIn = new URL("./native/react-native.ts", import.meta.url).href;
registerHooks({
  resolve: (specifier, context, nextResolve) =>
    specifier === "react-native"
      ? { url: standIn, format: "module-typescript", shortCircuit: true }
      : nextResolve(specifier, context),
});

// The library's main entry registers cleanup and its matchers through Jest's globals, which our
// runner doesn't define. Tests import `@testing-library/react-native/pure` and cleanup runs here.
const { cleanup } = await import("@testing-library/react-native/pure");
afterEach(cleanup);
