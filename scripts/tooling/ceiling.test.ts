import { expect, test } from "vite-plus/test";
import { checkCeiling } from "./ceiling.ts";

test("rejects a new file even if another file improves", () => {
  expect(checkCeiling({ "a.ts": 2 }, { "a.ts": 1, "b.ts": 1 }, { "a.ts": 2 })).toEqual([
    "b.ts: 1 violations exceed 0",
  ]);
});
test("rejects increases to the committed ceiling", () => {
  expect(checkCeiling({ "a.ts": 3 }, { "a.ts": 2 }, { "a.ts": 2 })).toContain(
    "a.ts: ceiling 3 exceeds previous 2",
  );
});
test("accepts a reduced ceiling and rejects counts above it", () => {
  expect(checkCeiling({ "a.ts": 1 }, { "a.ts": 1 }, { "a.ts": 2 })).toEqual([]);
  expect(checkCeiling({ "a.ts": 1 }, { "a.ts": 2 }, { "a.ts": 2 })).toContain(
    "a.ts: 2 violations exceed 1",
  );
});
