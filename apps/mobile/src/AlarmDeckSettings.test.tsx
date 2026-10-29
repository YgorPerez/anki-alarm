/* oxlint-disable eslint/no-await-in-loop -- Presses land one after another, as a thumb does them. */
import { fireEvent, screen } from "@testing-library/react-native/pure";
import { expect, test } from "vite-plus/test";
import { Effect } from "effect";
import { MAX_NEED, newAlarm } from "@app/core";
import { renderOptions } from "../test/alarm-options.tsx";
import { localData } from "./database.ts";
import { AlarmDeckSettings } from "./AlarmDeckSettings.tsx";

test("the alarm editor picks a deck and N", async () => {
  await Effect.runPromise(
    localData((data) =>
      data.changeCollection((c) => {
        c.createDeck("Inglês");
        c.createDeck("Inglês::Verbos");
      }),
    ),
  );
  await renderOptions(AlarmDeckSettings, newAlarm("a"), "en");
  await fireEvent.press(await screen.findByRole("radio", { name: "Inglês::Verbos" }));
  await screen.findByRole("radio", { name: "Inglês::Verbos", checked: true });
  screen.getByRole("radio", { name: "Inglês", checked: false });

  screen.getByText("3 cards");
  await fireEvent.press(screen.getByRole("button", { name: "More cards" }));
  await screen.findByText("4 cards");
  for (let i = 0; i < 4; i++)
    await fireEvent.press(screen.getByRole("button", { name: "Fewer cards" }));
  // At least one card dismisses an alarm.
  await screen.findByText("1 cards");
  for (let i = 1; i <= MAX_NEED; i++)
    await fireEvent.press(screen.getByRole("button", { name: "More cards" }));
  expect(await screen.findByText(`${MAX_NEED} cards`)).toBeDefined();
});
