import { fireEvent, render, screen } from "@testing-library/react-native/pure";
import { expect, test, vi } from "vite-plus/test";
import { OtherAlarmCard, type OtherAlarm } from "./OtherAlarmCard.tsx";

const now = Date.parse("2026-10-30T03:00:00Z");
const today = Date.parse("2026-10-30T06:30:00Z");
const card = (
  alarm: OtherAlarm | null,
  locale: "pt-BR" | "en" = "pt-BR",
  onOpen: () => boolean = () => true,
) => (
  <OtherAlarmCard alarm={alarm} locale={locale} now={now} zone="UTC" use24Hour onOpen={onOpen} />
);

test("shows the time and the app, speaks a full sentence, and opens that app when tapped", async () => {
  const onOpen = vi.fn<() => boolean>(() => true);
  await render(card({ at: today, app: "Relógio", icon: null }, "pt-BR", onOpen));
  expect(screen.getByText("06:30")).toBeTruthy();
  expect(screen.getByText("Relógio · hoje")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Relógio toca às 06:30" }));
  expect(onOpen).toHaveBeenCalledOnce();
  expect(screen.queryByRole("alert")).toBeNull();
});

test("gives the day when the alarm isn't today", async () => {
  const at = Date.parse("2026-10-31T06:30:00Z");
  await render(card({ at, app: "Clock", icon: null }, "en"));
  expect(screen.getByText(/^Clock · .*Oct/)).toBeTruthy();
  expect(screen.getByRole("button", { name: /^Clock rings .*Oct.* at 06:30$/ })).toBeTruthy();
});

test("shows the app's own icon when Android gives one", async () => {
  const icon = "data:image/png;base64,AAAA";
  await render(card({ at: today, app: "Clock", icon }));
  expect(screen.getByTestId("other-alarm-icon")).toHaveProperty("props.source", { uri: icon });
});

test("falls back to a generic name when Android hides the app", async () => {
  await render(card({ at: today, app: null, icon: null }, "en"));
  expect(screen.getByText("Another app · today")).toBeTruthy();
});

test("says so when the app can't be opened", async () => {
  await render(card({ at: today, app: "Clock", icon: null }, "pt-BR", () => false));
  await fireEvent.press(screen.getByRole("button"));
  expect(screen.getByRole("alert")).toHaveProperty("props.children", "Não deu para abrir o Clock.");
});

test("shows nothing without an alarm, or once it has passed", async () => {
  await render(card(null));
  expect(screen.queryByRole("button")).toBeNull();
  await render(card({ at: now - 1, app: "Clock", icon: null }));
  expect(screen.queryByRole("button")).toBeNull();
});
