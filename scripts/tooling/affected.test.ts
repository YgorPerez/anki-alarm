import { expect, test } from "vite-plus/test";
import { ciScope } from "./affected.ts";

test("main and tags run all packages and Maestro", () => {
  expect(ciScope(undefined, [])).toEqual({ all: true, mobile: true });
});
test("web-only PRs select affected packages and skip Maestro", () => {
  expect(ciScope("origin/main", ["apps/web/src/routes/index.tsx"])).toEqual({
    all: false,
    mobile: false,
  });
});
test("mobile and native-module PRs run Maestro", () => {
  for (const file of ["apps/mobile/src/App.tsx", "modules/alarm-native/index.ts"]) {
    expect(ciScope("origin/main", [file]).mobile).toBe(true);
  }
});
test("shared tooling changes check the entire workspace", () => {
  expect(ciScope("origin/main", ["pnpm-lock.yaml"])).toEqual({ all: true, mobile: false });
});
