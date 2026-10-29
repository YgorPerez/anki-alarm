/* oxlint-disable eslint/no-await-in-loop -- Presses land one after another, as a thumb does them. */
import { fireEvent, screen } from "@testing-library/react-native/pure";
import { expect, test } from "vite-plus/test";
import { MAX_SNOOZE_CAP, newAlarm } from "@app/core";
import { renderOptions } from "../test/alarm-options.tsx";
import { AlarmSnoozeSettings } from "./AlarmSnoozeSettings.tsx";

test("the alarm editor turns snooze on or off and sets its length and cap", async () => {
  await renderOptions(AlarmSnoozeSettings, newAlarm("a"), "en");
  screen.getByText("Each snooze adds 2 cards to the ring.");
  screen.getByRole("radio", { name: "9 min", checked: true });
  await fireEvent.press(screen.getByRole("radio", { name: "15 min" }));
  await screen.findByRole("radio", { name: "15 min", checked: true });

  screen.getByText("2 snoozes");
  await fireEvent.press(screen.getByRole("button", { name: "More snoozes" }));
  await screen.findByText("3 snoozes");
  for (let i = 0; i < 3; i++)
    await fireEvent.press(screen.getByRole("button", { name: "Fewer snoozes" }));
  // One snooze is the least a ring with snooze offers.
  await screen.findByText("1 snooze");
  for (let i = 1; i <= MAX_SNOOZE_CAP; i++)
    await fireEvent.press(screen.getByRole("button", { name: "More snoozes" }));
  await screen.findByText(`${MAX_SNOOZE_CAP} snoozes`);

  await fireEvent(screen.getByLabelText("Allow snooze"), "valueChange", false);
  // With snooze off, its length and cap are hidden.
  expect(screen.queryByRole("radio", { name: "15 min" })).toBeNull();
  expect(screen.queryByRole("button", { name: "More snoozes" })).toBeNull();
});
