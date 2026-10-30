import { expect, test } from "vite-plus/test";
import { intervalText } from "./interval-text.ts";

test.each([
  [30, "<30s", "<30s"],
  [60, "<1min(s)", "<1m"],
  [600, "<10min(s)", "<10m"],
  [1200, "20min(s)", "20m"],
  [5400, "1,5h", "1.5h"],
  [86400, "1dia(s)", "1d"],
  [4 * 86400, "4dia(s)", "4d"],
  [(365 * 86400) / 12, "1mês(es)", "1mo"],
  [365 * 86400, "1a", "1y"],
])("formats %i seconds like Anki's short answer-button time", (seconds, pt, en) => {
  expect(intervalText(seconds, "pt-BR")).toBe(pt);
  expect(intervalText(seconds, "en")).toBe(en);
});
