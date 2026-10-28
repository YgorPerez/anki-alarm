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

  test("fills in {placeholders}, leaving unknown ones as they are", () => {
    const pair = {
      "pt-BR": { pair: "{a} e {b} se parecem." },
      en: { pair: "{a} and {b} look alike." },
    };
    expect(translator(pair, "en")("pair", { a: "Again", b: "Hard" })).toBe(
      "Again and Hard look alike.",
    );
    expect(translator(pair)("pair", { a: "De novo" })).toBe("De novo e {b} se parecem.");
  });
});
