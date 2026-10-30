import { expect, test } from "vite-plus/test";
import { ciScope } from "./affected.ts";

test("main and tags run all packages", () => {
  expect(ciScope(undefined, [])).toEqual({ all: true });
});
test("web-only PRs select affected packages", () => {
  expect(ciScope("origin/main", ["apps/web/src/routes/index.tsx"])).toEqual({ all: false });
});
test("shared tooling changes check the entire workspace", () => {
  expect(ciScope("origin/main", ["pnpm-lock.yaml"])).toEqual({ all: true });
});
