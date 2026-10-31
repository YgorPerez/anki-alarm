import { fireEvent, render, screen } from "@testing-library/react-native/pure";
import { expect, test, vi } from "vite-plus/test";
import { OtherAlarmNote, type OtherAlarm } from "./OtherAlarmNote.tsx";

const now = Date.parse("2026-10-30T03:00:00Z");
const note = (alarm: OtherAlarm | null, locale: "pt-BR" | "en" = "pt-BR", onOpen = () => {}) => (
  <OtherAlarmNote alarm={alarm} locale={locale} now={now} zone="UTC" use24Hour onOpen={onOpen} />
);

test("names the app and the time, and opens that app when tapped", async () => {
  const onOpen = vi.fn<() => void>();
  await render(note({ at: Date.parse("2026-10-30T06:30:00Z"), app: "Relógio" }, "pt-BR", onOpen));
  await fireEvent.press(screen.getByRole("button", { name: "Relógio toca às 06:30" }));
  expect(onOpen).toHaveBeenCalledOnce();
});

test("adds the day when the alarm isn't today", async () => {
  await render(note({ at: Date.parse("2026-10-31T06:30:00Z"), app: "Clock" }, "en"));
  expect(screen.getByText(/^Clock rings .*Oct.* at 06:30$/)).toBeTruthy();
});

test("falls back to a generic name when Android hides the app's", async () => {
  await render(note({ at: Date.parse("2026-10-30T06:30:00Z"), app: null }, "en"));
  expect(screen.getByText("Another app rings at 06:30")).toBeTruthy();
});

test("shows nothing without an alarm, or once it has passed", async () => {
  await render(note(null));
  expect(screen.queryByRole("button")).toBeNull();
  await render(note({ at: now - 1, app: "Clock" }));
  expect(screen.queryByRole("button")).toBeNull();
});
