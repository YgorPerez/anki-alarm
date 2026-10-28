import { fireEvent, render, screen } from "@testing-library/react-native/pure";
import { expect, test } from "vite-plus/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Effect } from "effect";
import { MAX_NEED, newAlarm, type Alarm } from "@app/core";
import { localData } from "./database.ts";
import { AlarmDeckSettings } from "./AlarmDeckSettings.tsx";

test("the alarm editor picks a deck and N", async () => {
  const state = await Effect.runPromise(
    localData((data) =>
      data.changeCollection((c) => {
        c.createDeck("Inglês");
        c.createDeck("Inglês::Verbos");
      }),
    ),
  );
  const verbs = state.decks.find((d) => d.fields.name.value === "Inglês::Verbos")!;
  let alarm: Alarm = newAlarm("a");
  const show = () => (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always" } } })
      }
    >
      <AlarmDeckSettings
        alarm={alarm}
        locale="en"
        onChange={(next) => {
          alarm = next;
        }}
      />
    </QueryClientProvider>
  );
  const view = await render(show());
  await fireEvent.press(await screen.findByRole("radio", { name: "Inglês::Verbos" }));
  expect(alarm.deckId).toBe(verbs.id);
  await view.rerender(show());
  screen.getByRole("radio", { name: "Inglês::Verbos", checked: true });
  screen.getByRole("radio", { name: "Inglês", checked: false });
  screen.getByText("3 cards");
  await fireEvent.press(screen.getByRole("button", { name: "More cards" }));
  expect(alarm.need).toBe(4);
  alarm = { ...alarm, need: 1 };
  await view.rerender(show());
  await fireEvent.press(screen.getByRole("button", { name: "Fewer cards" }));
  expect(alarm.need).toBe(1);
  alarm = { ...alarm, need: MAX_NEED };
  await view.rerender(show());
  await fireEvent.press(screen.getByRole("button", { name: "More cards" }));
  expect(alarm.need).toBe(MAX_NEED);
});
