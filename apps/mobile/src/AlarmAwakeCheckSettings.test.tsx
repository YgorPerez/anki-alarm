import { fireEvent, screen } from "@testing-library/react-native/pure";
import { expect, test } from "vite-plus/test";
import { newAlarm } from "@app/core";
import { renderOptions } from "../test/alarm-options.tsx";
import { AlarmAwakeCheckSettings } from "./AlarmAwakeCheckSettings.tsx";

test("the alarm editor turns the awake check on and picks its delay", async () => {
  await renderOptions(AlarmAwakeCheckSettings, newAlarm("a"), "en");
  expect(screen.queryByRole("radio", { name: "5 min" })).toBeNull();
  await fireEvent(screen.getByLabelText("Awake check"), "valueChange", true);
  await screen.findByText(
    "One card after dismissal. No answer in 60 seconds rings the alarm again.",
  );
  screen.getByRole("radio", { name: "5 min", checked: true });
  await fireEvent.press(screen.getByRole("radio", { name: "10 min" }));
  await screen.findByRole("radio", { name: "10 min", checked: true });
  await fireEvent(screen.getByLabelText("Awake check"), "valueChange", false);
  expect(screen.queryByRole("radio", { name: "10 min" })).toBeNull();
  // Turned on again, it keeps the delay picked before.
  await fireEvent(screen.getByLabelText("Awake check"), "valueChange", true);
  await screen.findByRole("radio", { name: "10 min", checked: true });
});
