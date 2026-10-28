import { describe, expect, it } from "vite-plus/test";
import fixtures from "../fixtures/next-ring.json" with { type: "json" };
import { nextRing } from "./index.ts";

describe("next ring", () => {
  it.each(fixtures)("$name", (fixture) => {
    expect(nextRing(fixture.rule, Date.parse(fixture.now), fixture.zone)).toBe(
      fixture.expected === null ? null : Date.parse(fixture.expected),
    );
  });
});
