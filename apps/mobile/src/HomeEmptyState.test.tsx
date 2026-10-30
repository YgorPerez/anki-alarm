import { act, fireEvent, render, screen } from "@testing-library/react-native/pure";
import { newAlarm } from "@app/core";
import { expect, test } from "vite-plus/test";
import { HomeScreen } from "./HomeScreen.tsx";

test("Home with remaining alarms but no decks guides to import or link, and + leads there instead of the editor", async () => {
  const actions: string[] = [];
  await render(
    <HomeScreen
      alarms={[{ ...newAlarm("remaining"), deckId: "deleted-deck" }]}
      decks={[]}
      locale="pt-BR"
      zone="UTC"
      use24Hour
      onEdit={() => {}}
      onAdd={() => actions.push("add")}
      onToggle={() => {}}
      setup={{
        onImport: async () => {
          actions.push("import");
          return undefined;
        },
        onLink: () => actions.push("link"),
      }}
    />,
  );
  expect(screen.getByText("Importe um baralho para criar seu primeiro alarme")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Importar .apkg" }));
  await fireEvent.press(screen.getByRole("button", { name: "Vincular do AnkiDroid" }));
  await fireEvent.press(screen.getByRole("button", { name: "Novo alarme" }));
  expect(actions).toEqual(["import", "link"]);
});

test("Home switches to creating the first alarm as soon as an imported deck arrives", async () => {
  const actions: string[] = [];
  const pending = Promise.withResolvers<{ notes: number; cards: number; entries: number }>();
  const view = (decks: { id: string; name: string }[]) => (
    <HomeScreen
      alarms={[]}
      decks={decks}
      locale="en"
      zone="UTC"
      use24Hour
      onEdit={() => {}}
      onAdd={() => actions.push("add")}
      onToggle={() => {}}
      setup={{
        onImport: () => pending.promise,
        onLink: () => {},
      }}
    />
  );
  const result = await render(view([]));
  expect(screen.getByText("Import a deck to create your first alarm")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Import .apkg" }));
  expect(screen.getByText("Importing…")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Import .apkg" }).props.accessibilityState,
  ).toMatchObject({ disabled: true });
  await act(async () => pending.resolve({ notes: 12, cards: 24, entries: 3 }));
  await result.rerender(view([{ id: "deck", name: "English" }]));
  expect(screen.queryByText("Import a deck to create your first alarm")).toBeNull();
  expect(screen.getByText("Imported 12 notes, 24 cards and 3 new reviews.")).toBeTruthy();
  expect(screen.getByText("Create your first alarm")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Create alarm" }));
  await fireEvent.press(screen.getByRole("button", { name: "New alarm" }));
  expect(actions).toEqual(["add", "add"]);
});

test("Home reports a failed import and keeps both ways to get a deck", async () => {
  await render(
    <HomeScreen
      alarms={[]}
      decks={[]}
      locale="pt-BR"
      zone="UTC"
      use24Hour
      onEdit={() => {}}
      onAdd={() => {}}
      onToggle={() => {}}
      setup={{ onImport: () => Promise.reject(new Error("bad file")), onLink: () => {} }}
    />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "Importar .apkg" }));
  expect(
    await screen.findByText(
      "Não foi possível importar esse arquivo. Confira se é um .apkg do Anki.",
    ),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Importar .apkg" }).props.accessibilityState,
  ).toMatchObject({ disabled: false });
  expect(screen.getByRole("button", { name: "Vincular do AnkiDroid" })).toBeTruthy();
});

test("Home with alarms shows no empty state", async () => {
  await render(
    <HomeScreen
      alarms={[{ ...newAlarm("a"), deckId: "deck" }]}
      decks={[{ id: "deck", name: "English" }]}
      locale="en"
      zone="UTC"
      use24Hour
      onEdit={() => {}}
      onAdd={() => {}}
      onToggle={() => {}}
      setup={{ onImport: async () => undefined, onLink: () => {} }}
    />,
  );
  expect(screen.queryByText("Create your first alarm")).toBeNull();
  expect(screen.queryByText("Import a deck to create your first alarm")).toBeNull();
});
