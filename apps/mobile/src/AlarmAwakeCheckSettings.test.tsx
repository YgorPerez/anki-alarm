import { fireEvent, render, screen } from "@testing-library/react-native/pure";
import { expect, test } from "vite-plus/test";
import { newAlarm, type Alarm } from "@app/core";
import { AlarmAwakeCheckSettings } from "./AlarmAwakeCheckSettings.tsx";

test("the alarm editor turns the awake check on and picks its delay", async () => {
  let alarm: Alarm = newAlarm("a");
  const show = () => (
    <AlarmAwakeCheckSettings
      alarm={alarm}
      locale="en"
      onChange={(next) => {
        alarm = next;
      }}
    />
  );
  const view = await render(show());
  expect(screen.queryByRole("radio", { name: "5 min" })).toBeNull();
  await fireEvent(screen.getByLabelText("Awake check"), "valueChange", true);
  expect(alarm.awakeCheck).toBe(true);
  await view.rerender(show());
  screen.getByText("One card after dismissal. No answer in 60 seconds rings the alarm again.");
  screen.getByRole("radio", { name: "5 min", checked: true });
  await fireEvent.press(screen.getByRole("radio", { name: "10 min" }));
  expect(alarm.awakeCheckMinutes).toBe(10);
  await view.rerender(show());
  screen.getByRole("radio", { name: "10 min", checked: true });
  await fireEvent(screen.getByLabelText("Awake check"), "valueChange", false);
  expect(alarm).toMatchObject({ awakeCheck: false, awakeCheckMinutes: 10 });
});
