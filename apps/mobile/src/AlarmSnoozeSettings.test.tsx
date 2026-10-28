import { fireEvent, render, screen } from "@testing-library/react-native/pure";
import { expect, test } from "vite-plus/test";
import { MAX_SNOOZE_CAP, newAlarm, type Alarm } from "@app/core";
import { AlarmSnoozeSettings } from "./AlarmSnoozeSettings.tsx";

test("the alarm editor turns snooze on or off and sets its length and cap", async () => {
  let alarm: Alarm = newAlarm("a");
  const show = () => (
    <AlarmSnoozeSettings
      alarm={alarm}
      locale="en"
      onChange={(next) => {
        alarm = next;
      }}
    />
  );
  const view = await render(show());
  screen.getByText("Each snooze adds 2 cards to the ring.");
  screen.getByRole("radio", { name: "9 min", checked: true });
  await fireEvent.press(screen.getByRole("radio", { name: "15 min" }));
  expect(alarm.snoozeMinutes).toBe(15);
  screen.getByText("2 snoozes");
  await fireEvent.press(screen.getByRole("button", { name: "More snoozes" }));
  expect(alarm.snoozeCap).toBe(3);
  alarm = { ...alarm, snoozeCap: 1 };
  await view.rerender(show());
  await fireEvent.press(screen.getByRole("button", { name: "Fewer snoozes" }));
  expect(alarm.snoozeCap).toBe(1);
  alarm = { ...alarm, snoozeCap: MAX_SNOOZE_CAP };
  await view.rerender(show());
  await fireEvent.press(screen.getByRole("button", { name: "More snoozes" }));
  expect(alarm.snoozeCap).toBe(MAX_SNOOZE_CAP);

  await fireEvent(screen.getByLabelText("Allow snooze"), "valueChange", false);
  expect(alarm.snooze).toBe(false);
  await view.rerender(show());
  // With snooze off, its length and cap are hidden.
  expect(screen.queryByRole("radio", { name: "15 min" })).toBeNull();
  expect(screen.queryByRole("button", { name: "More snoozes" })).toBeNull();
});
