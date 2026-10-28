import { fireEvent, render, screen } from "@testing-library/react-native/pure";
import { expect, test } from "vite-plus/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Effect } from "effect";
import { deckLanguage, newAlarm, type Alarm } from "@app/core";
import { localData } from "./database.ts";
import { AlarmReadAloudSettings } from "./AlarmReadAloudSettings.tsx";

test("the alarm editor turns read aloud on and sets the deck's language", async () => {
  const state = await Effect.runPromise(
    localData((data) => data.changeCollection((c) => void c.createDeck("Inglês"))),
  );
  const deck = state.decks.find((d) => d.fields.name.value === "Inglês")!;
  let alarm: Alarm = { ...newAlarm("a"), deckId: deck.id };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: "always" } },
  });
  const show = () => (
    <QueryClientProvider client={client}>
      <AlarmReadAloudSettings
        alarm={alarm}
        locale="pt-BR"
        onChange={(next) => {
          alarm = next;
        }}
      />
    </QueryClientProvider>
  );
  const view = await render(show());
  expect(screen.queryByRole("radio", { name: "English (US)" })).toBeNull();
  await fireEvent(screen.getByLabelText("Ler em voz alta"), "valueChange", true);
  expect(alarm.readAloud).toBe(true);
  await view.rerender(show());
  await screen.findByRole("radio", { name: "Português (Brasil)", checked: true });
  await fireEvent.press(screen.getByRole("radio", { name: "English (US)" }));
  await screen.findByRole("radio", { name: "English (US)", checked: true });
  const saved = await Effect.runPromise(localData((data) => data.collection));
  expect(deckLanguage(saved, deck.id)).toBe("en-US");
});

test("the language waits for a deck", async () => {
  await render(
    <QueryClientProvider client={new QueryClient()}>
      <AlarmReadAloudSettings
        alarm={{ ...newAlarm("a"), readAloud: true }}
        locale="en"
        onChange={() => {}}
      />
    </QueryClientProvider>,
  );
  screen.getByText("Choose a deck to set the language it's read in.");
  expect(screen.queryByRole("radio")).toBeNull();
});
