import { fireEvent, render, screen } from "@testing-library/react-native/pure";
import { expect, test } from "vite-plus/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Effect } from "effect";
import { newAlarm, type Alarm } from "@app/core";
import { renderOptions } from "../test/alarm-options.tsx";
import { localData } from "./database.ts";
import { AlarmReadAloudSettings } from "./AlarmReadAloudSettings.tsx";

test("the alarm editor turns read aloud on and sets the deck's language", async () => {
  const state = await Effect.runPromise(
    localData((data) => data.changeCollection((c) => void c.createDeck("Inglês"))),
  );
  const deck = state.decks.find((d) => d.fields.name.value === "Inglês")!;
  const alarm: Alarm = { ...newAlarm("a"), deckId: deck.id };
  const view = await renderOptions(AlarmReadAloudSettings, alarm, "pt-BR");
  expect(screen.queryByRole("radio", { name: "English (US)" })).toBeNull();
  await fireEvent(screen.getByLabelText("Ler em voz alta"), "valueChange", true);
  await screen.findByRole("radio", { name: "Português (Brasil)", checked: true });
  await fireEvent.press(screen.getByRole("radio", { name: "English (US)" }));
  await screen.findByRole("radio", { name: "English (US)", checked: true });
  // The language is the deck's: an editor opened again shows it.
  await view.unmount();
  await renderOptions(AlarmReadAloudSettings, { ...alarm, readAloud: true }, "pt-BR");
  await screen.findByRole("radio", { name: "English (US)", checked: true });
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
