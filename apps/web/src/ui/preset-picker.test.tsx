import { Collection } from "@app/core";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vite-plus/test";
import { PresetPicker } from "./preset-picker.tsx";

test("two presets named Default can be told apart, and their names stay", () => {
  const c = new Collection({ deviceId: "web", now: () => 1000, random: () => new Uint8Array(16) });
  const deck = c.createDeck("Palavras");
  const state = c.snapshot();
  state.presets.push({ ...structuredClone(state.presets[0]!), id: "imported", anki: { id: 1 } });
  render(
    <PresetPicker
      state={state}
      preset={state.presets[0]!}
      deckId={deck.id}
      locale="en"
      onChange={async () => {}}
    />,
  );
  expect(screen.getByRole("option", { name: "Default (this app)" })).toBeDefined();
  expect(screen.getByRole("option", { name: "Default (from Anki)" })).toBeDefined();
  expect(state.presets.map((p) => p.fields.name.value)).toEqual(["Default", "Default"]);
  expect(screen.getByText("Used by 1 deck")).toBeDefined();
});
