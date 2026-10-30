import { act, fireEvent, render, screen } from "@testing-library/react-native/pure";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { newAlarm, type Alarm } from "@app/core";
import { HomeScreen } from "./HomeScreen.tsx";
import { AlarmEditorScreen } from "./AlarmEditorScreen.tsx";

afterEach(() => vi.useRealTimers());

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
  await fireEvent(screen.getByRole("button", { name: /Work/ }), "longPress");
  await fireEvent.press(screen.getByRole("button", { name: "Duplicate alarm" }));
  expect(copies).toEqual([alarm]);
});

test("the editor duplicates its current settings without saving the source", async () => {
  const alarm = { ...newAlarm("a"), deckId: "deck" };
  const copies: Alarm[] = [];
  await render(
    <AlarmEditorScreen
      iconColor="#8c8c8c"
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
  expect(screen.queryByText("Work · 3 cartões")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Desfazer" }));
  expect(restored).toEqual([alarm]);
  expect(screen.queryByText("Alarme excluído")).toBeNull();
});

test("failed deletes keep the card, and a successful delete expires its Undo", async () => {
  vi.useFakeTimers();
  const alarm = { ...newAlarm("a"), label: "Work" };
  let fail = true;
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
      onDelete={async () => {
        if (fail) throw new Error("offline storage failed");
      }}
      onRestore={async () => {}}
    />,
  );
  await fireEvent(screen.getByTestId("swipe-alarm-a"), "responderRelease", {}, { dx: 120, dy: 0 });
  expect(screen.getByText("Work · 3 cards")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  fail = false;
  await fireEvent(screen.getByTestId("swipe-alarm-a"), "responderRelease", {}, { dx: 120, dy: 0 });
  expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
  await act(() => vi.advanceTimersByTime(9000));
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  expect(screen.queryByText("Work · 3 cards")).toBeNull();
});

test("a card opens its delete action for TalkBack and Undo restores it", async () => {
  const alarm = { ...newAlarm("a"), label: "Work", enabled: false };
  const removed = vi.fn<(id: string) => Promise<void>>(async () => {});
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
      onDelete={removed}
      onRestore={async () => {}}
    />,
  );
  const card = screen.getByRole("button", { name: /Work/ });
  expect(card.props.accessibilityActions).toContainEqual({
    name: "longpress",
    label: "More options",
  });
  await fireEvent(card, "accessibilityAction", { nativeEvent: { actionName: "longpress" } });
  await fireEvent.press(screen.getByRole("button", { name: "Delete alarm" }));
  expect(removed).toHaveBeenCalledWith("a");
  expect(screen.queryByText("Work · 3 cards")).toBeNull();
  expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
});
