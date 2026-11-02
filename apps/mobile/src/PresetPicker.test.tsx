import { Collection } from "@app/core";
import { fireEvent, render, screen } from "@testing-library/react-native/pure";
import { expect, test } from "vite-plus/test";
import { PresetPicker } from "./PresetPicker.tsx";

/** A deck on the app's Default, beside the Default a link or import brought. */
function twoDefaults() {
  const c = new Collection({
    deviceId: "phone",
    now: () => 1000,
    random: () => new Uint8Array(16),
  });
  const deck = c.createDeck("Palavras");
  const state = c.snapshot();
  state.presets.push({ ...structuredClone(state.presets[0]!), id: "imported", anki: { id: 1 } });
  return { state, preset: state.presets[0]!, deckId: deck.id };
}

test("two presets named Default can be told apart, and their names stay", async () => {
  const { state, preset, deckId } = twoDefaults();
  await render(
    <PresetPicker
      state={state}
      preset={preset}
      deckId={deckId}
      locale="pt-BR"
      busy={false}
      onChange={() => {}}
    />,
  );
  expect(screen.getByRole("radio", { name: "Default (deste app)" })).toBeDefined();
  expect(screen.getByRole("radio", { name: "Default (do Anki)" })).toBeDefined();
  expect(state.presets.map((p) => p.fields.name.value)).toEqual(["Default", "Default"]);
  expect(screen.getByText("Usada por 1 baralho")).toBeDefined();
});

test("preset management stays collapsed until asked for", async () => {
  const { state, preset, deckId } = twoDefaults();
  await render(
    <PresetPicker
      state={state}
      preset={preset}
      deckId={deckId}
      locale="en"
      busy={false}
      onChange={() => {}}
    />,
  );
  expect(screen.queryByRole("button", { name: "Create preset" })).toBeNull();
  const manage = screen.getByRole("button", { name: "Manage presets" });
  expect(manage.props.accessibilityState.expanded).toBe(false);
  await fireEvent.press(manage);
  expect(screen.getByRole("button", { name: "Create preset" })).toBeDefined();
  expect(
    screen.getByRole("button", { name: "Manage presets" }).props.accessibilityState.expanded,
  ).toBe(true);
});
