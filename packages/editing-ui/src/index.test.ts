import { translator } from "@app/core";
import { expect, test } from "vite-plus/test";
import { editingMessages } from "./index.ts";

test("the editors' copy states Core's limits, in each locale's number format", () => {
  const pt = translator(editingMessages, "pt-BR");
  const en = translator(editingMessages, "en");
  expect(pt("invalidLimit")).toBe("Use um número inteiro de 0 a 9999.");
  expect(pt("invalidRetention")).toBe("Use um valor de 0,70 a 0,99.");
  expect(en("invalidRetention")).toBe("Use a value from 0.70 to 0.99.");
  expect(en("invalidParameters")).toBe("Enter FSRS-6's 21 numbers.");
  expect(en("invalidDays")).toBe("Use a whole number from 0 to 36500.");
});
