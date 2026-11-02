import { translator } from "@app/core";
import { describe, expect, test } from "vite-plus/test";
import { editingMessages, presetChoices, usedByDecksText } from "./index.ts";

test("the editors' copy states Core's limits, in each locale's number format", () => {
  const pt = translator(editingMessages, "pt-BR");
  const en = translator(editingMessages, "en");
  expect(pt("invalidLimit")).toBe("Use um número inteiro de 0 a 9999.");
  expect(pt("invalidRetention")).toBe("Use um valor de 0,70 a 0,99.");
  expect(en("invalidRetention")).toBe("Use a value from 0.70 to 0.99.");
  expect(en("invalidParameters")).toBe("Enter FSRS-6's 21 numbers.");
  expect(en("invalidDays")).toBe("Use a whole number from 0 to 36500.");
});

type PresetRow = { id: string; name: string; anki?: boolean };
const presets = (...rows: PresetRow[]) =>
  rows.map(({ id, name, anki }) =>
    Object.assign({ id, fields: { name: { value: name } } }, anki ? { anki: { id: 1 } } : {}),
  );

describe("presetChoices", () => {
  test("a unique name stays as it is", () => {
    expect(
      presetChoices(presets({ id: "a", name: "Default" }, { id: "b", name: "Mine" }), "en"),
    ).toEqual([
      { value: "a", label: "Default" },
      { value: "b", label: "Mine" },
    ]);
  });

  test.each([
    ["en", "Default (this app)", "Default (from Anki)"],
    ["pt-BR", "Default (deste app)", "Default (do Anki)"],
  ] as const)("a shared name says where each came from in %s", (locale, own, anki) => {
    const rows = presets({ id: "a", name: "Default" }, { id: "b", name: "Default", anki: true });
    expect(presetChoices(rows, locale).map((c) => c.label)).toEqual([own, anki]);
  });

  test("the same name from the same origin is numbered, in the same order on every device", () => {
    const rows = presets(
      { id: "b", name: "Hard", anki: true },
      { id: "a", name: "Hard", anki: true },
    );
    expect(presetChoices(rows, "en")).toEqual([
      { value: "b", label: "Hard (from Anki) 2" },
      { value: "a", label: "Hard (from Anki)" },
    ]);
  });
});

test.each([
  ["en", 1, "Used by 1 deck"],
  ["en", 2, "Used by 2 decks"],
  ["en", 0, "Used by 0 decks"],
  ["pt-BR", 1, "Usada por 1 baralho"],
  ["pt-BR", 2, "Usada por 2 baralhos"],
] as const)("usedByDecksText in %s for %i", (locale, count, text) => {
  expect(usedByDecksText(count, locale)).toBe(text);
});
