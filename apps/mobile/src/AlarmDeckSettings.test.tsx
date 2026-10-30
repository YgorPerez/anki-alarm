import { fireEvent, screen } from "@testing-library/react-native/pure";
import { expect, test } from "vite-plus/test";
import { Effect } from "effect";
import { newAlarm } from "@app/core";
import { renderOptions } from "../test/alarm-options.tsx";
import { localData } from "./database.ts";
import { AlarmDeckSettings } from "./AlarmDeckSettings.tsx";

test("the alarm editor picks a deck", async () => {
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
  expect(screen.getByRole("radio", { name: "Inglês", checked: false })).toBeDefined();
});
