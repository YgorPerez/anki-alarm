import { describe, expect, test } from "vite-plus/test";

import { translator } from "./index.ts";

describe("translator", () => {
  const messages = {
    "pt-BR": { greeting: "Bom dia", start: "Começar" },
    en: { greeting: "Good morning" },
  };

  test("speaks pt-BR by default", () => {
    expect(translator(messages)("greeting")).toBe("Bom dia");
  });

  test("speaks English when asked", () => {
    expect(translator(messages, "en")("greeting")).toBe("Good morning");
  });

  test("falls back to pt-BR for a string missing in English", () => {
    expect(translator(messages, "en")("start")).toBe("Começar");
  });
});
