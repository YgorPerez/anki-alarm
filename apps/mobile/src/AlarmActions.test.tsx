import { fireEvent, render, screen } from "@testing-library/react-native/pure";
import { expect, test } from "vite-plus/test";
import { newAlarm, type Alarm } from "@app/core";
import { HomeScreen } from "./HomeScreen.tsx";
import { AlarmEditorScreen } from "./AlarmEditorScreen.tsx";

test("Home offers duplicate from the card menu", async () => {
  const alarm = { ...newAlarm("a"), label: "Work" };
  const copies: Alarm[] = [];
  await render(
    <HomeScreen
      alarms={[alarm]}
      decks={[]}
      locale="en"
      zone="UTC"
      use24Hour
      onEdit={() => {}}
      onAdd={() => {}}
      onToggle={() => {}}
      onDuplicate={(a) => copies.push(a)}
    />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "More options, Work" }));
  await fireEvent.press(screen.getByRole("button", { name: "Duplicate alarm" }));
  expect(copies).toEqual([alarm]);
});

test("the editor duplicates its current settings without saving the source", async () => {
  const alarm = { ...newAlarm("a"), deckId: "deck" };
  const copies: Alarm[] = [];
  await render(
    <AlarmEditorScreen
      alarm={alarm}
      saved
      locale="pt-BR"
      hour24
      onSave={async () => {
        throw new Error("must not save");
      }}
      onDelete={async () => {}}
      onClose={() => {}}
      onDuplicate={(a) => copies.push(a)}
    />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "Mais opções" }));
  await fireEvent.press(screen.getByRole("button", { name: "Duplicar alarme" }));
  expect(copies).toEqual([alarm]);
});

test("swiping deletes the alarm and Undo restores its settings", async () => {
  const alarm = { ...newAlarm("a"), label: "Work", enabled: false };
  const removed: string[] = [];
  const restored: Alarm[] = [];
  await render(
    <HomeScreen
      alarms={[alarm]}
      decks={[]}
      locale="pt-BR"
      zone="UTC"
      use24Hour
      onEdit={() => {}}
      onAdd={() => {}}
      onToggle={() => {}}
      onDelete={async (id) => {
        removed.push(id);
      }}
      onRestore={async (a) => {
        restored.push(a);
      }}
    />,
  );
  const card = screen.getByTestId("swipe-alarm-a");
  await fireEvent(card, "responderRelease", {}, { dx: -30, dy: 0 });
  expect(removed).toEqual([]);
  await fireEvent(card, "responderRelease", {}, { dx: -120, dy: 5 });
  expect(removed).toEqual(["a"]);
  expect(screen.queryByText("Work")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Desfazer" }));
  expect(restored).toEqual([alarm]);
  expect(screen.queryByText("Alarme excluído")).toBeNull();
});
