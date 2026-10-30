import { StyleSheet } from "react-native";
/* oxlint-disable eslint/no-await-in-loop -- Presses land one after another, as a thumb does them. */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native/pure";
import { expect, test, vi } from "vite-plus/test";
import { newAlarm, newAlarmFor, type Alarm, type Locale } from "@app/core";
import {
  alerts,
  answerAlert,
  pressBack,
  toasts,
  windowDimensions,
} from "../test/native/react-native.ts";
import { answerPicker, pickers } from "../test/native/datetimepicker.ts";
import { AlarmEditorScreen } from "./AlarmEditorScreen.tsx";

const zone = "America/Sao_Paulo";
// Wednesday 2026-10-28, 23:18 in São Paulo.
const now = () => Date.parse("2026-10-29T02:18:00Z");

/** The native scroll view behind a wheel; TalkBack only reaches the control around it. */
const wheelScroll = (name: string) =>
  screen.getByTestId(`time-wheel-${name}`, { includeHiddenElements: true });

/** The editor on its route: what it saved or deleted, and whether it left. */
async function openEditor(
  alarm: Alarm,
  {
    saved = false,
    locale = "en",
    hour24 = true,
  }: { saved?: boolean; locale?: Locale; hour24?: boolean } = {},
) {
  const done = { saved: [] as Alarm[], deleted: [] as string[], closed: 0 };
  // One editor on the screen at a time, as on the route.
  await cleanup();
  await render(
    <AlarmEditorScreen
      alarm={alarm}
      saved={saved}
      locale={locale}
      hour24={hour24}
      now={now}
      zone={zone}
      onSave={async (next) => {
        done.saved.push(next);
      }}
      onDelete={async (id) => {
        done.deleted.push(id);
      }}
      onClose={() => done.closed++}
    />,
  );
  return done;
}

test("a new alarm takes its time from inline wheels, its days from the Repeat sheet, and says when it rings", async () => {
  const done = await openEditor(
    newAlarmFor("a", { alarms: [], lastSavedId: null, deckIds: ["inglês"] }),
  );
  for (const part of ["07", "00"])
    for (const value of screen.getAllByText(part, { includeHiddenElements: true }))
      expect(StyleSheet.flatten(value.props.style)).toMatchObject({
        fontFamily: "Inter_700Bold",
        fontVariant: ["tabular-nums"],
      });
  expect(screen.queryByRole("button", { name: "More options" })).toBeNull();

  // The native scroll offset is in points; rows are 76 points at the default font scale.
  await fireEvent(wheelScroll("Hours"), "momentumScrollEnd", {
    nativeEvent: { contentOffset: { y: 6 * 76 } },
  });
  await fireEvent(wheelScroll("Minutes"), "momentumScrollEnd", {
    nativeEvent: { contentOffset: { y: 30 * 76 } },
  });
  expect(screen.getByRole("adjustable", { name: "Hours" }).props.accessibilityValue.text).toBe(
    "06",
  );
  expect(screen.getByRole("adjustable", { name: "Minutes" }).props.accessibilityValue.text).toBe(
    "30",
  );
  expect(screen.queryByRole("adjustable", { name: "AM/PM" })).toBeNull();

  await fireEvent.press(screen.getByRole("button", { name: "Repeat, Weekdays" }));
  await fireEvent.press(screen.getByRole("button", { name: "Every day" }));
  for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])
    screen.getByRole("checkbox", { name: day, checked: true });
  await fireEvent.press(screen.getByRole("checkbox", { name: "Sun" }));
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  screen.getByRole("button", { name: "Repeat, Mon, Tue, Wed, Thu, Fri, Sat" });

  await fireEvent.press(screen.getByRole("button", { name: "Label, None" }));
  await fireEvent.changeText(screen.getByLabelText("Label"), "Academia");
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  screen.getByRole("button", { name: "Label, Academia" });

  await fireEvent.press(screen.getByRole("button", { name: "Save" }));
  expect(done.saved).toEqual([
    {
      ...newAlarm("a"),
      deckId: "inglês",
      label: "Academia",
      rule: { hour: 6, minute: 30, repeatDays: [1, 2, 3, 4, 5, 6] },
    },
  ]);
  expect(toasts.at(-1)).toBe("Rings in 7 h 12 min");
  expect(done.closed).toBe(1);
});

test("a one-off date comes from the calendar, and no days at all rings once at the next 07:00", async () => {
  const alarm = { ...newAlarm("a"), deckId: "inglês" };
  const done = await openEditor(alarm, { locale: "pt-BR" });
  await fireEvent.press(screen.getByRole("button", { name: "Repetir, Dias úteis" }));
  await fireEvent.press(screen.getByRole("button", { name: "Data única" }));
  expect(pickers.at(-1)).toMatchObject({ mode: "date", minimumDate: new Date(2026, 9, 28) });
  await act(() => answerPicker(new Date(2026, 10, 5)));
  screen.getByRole("checkbox", { name: "Seg", checked: false });
  await fireEvent.press(screen.getByRole("button", { name: "Pronto" }));
  screen.getByRole("button", { name: /^Repetir, 5 de nov\. de 2026$/ });
  await fireEvent.press(screen.getByRole("button", { name: "Salvar" }));
  expect(done.saved.at(-1)?.rule).toEqual({ hour: 7, minute: 0, onceDate: "2026-11-05" });
  expect(toasts.at(-1)).toBe("Toca em 7 d 7 h 42 min");

  const again = await openEditor(alarm, { locale: "en" });
  await fireEvent.press(screen.getByRole("button", { name: "Repeat, Weekdays" }));
  for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri"])
    await fireEvent.press(screen.getByRole("checkbox", { name: day }));
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  screen.getByRole("button", { name: "Repeat, Once" });
  await fireEvent.press(screen.getByRole("button", { name: "Save" }));
  expect(again.saved.at(-1)?.rule).toEqual({ hour: 7, minute: 0, onceDate: "2026-10-29" });
  expect(toasts.at(-1)).toBe("Rings in 7 h 42 min");
});

test("editing keeps the alarm's id, Back closes a sheet first, and leaving asks before discarding changes", async () => {
  const alarm: Alarm = { ...newAlarm("a"), deckId: "inglês", label: "Trabalho", enabled: false };
  const done = await openEditor(alarm, { saved: true, hour24: false });
  screen.getByRole("adjustable", { name: "AM/PM" });

  await fireEvent.press(screen.getByRole("button", { name: "Label, Trabalho" }));
  await fireEvent.changeText(screen.getByLabelText("Label"), "Folga");
  await act(async () => {
    expect(pressBack()).toBe(true);
  });
  expect(screen.queryByLabelText("Label")).toBeNull();
  screen.getByRole("button", { name: "Label, Folga" });
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(done.closed).toBe(0);
  await act(() => answerAlert("Discard"));
  expect(done).toMatchObject({ saved: [], closed: 1 });

  const edited = await openEditor(alarm, { saved: true });
  await fireEvent(wheelScroll("Hours"), "momentumScrollEnd", {
    nativeEvent: { contentOffset: { y: 23 * 76 } },
  });
  await fireEvent(wheelScroll("Minutes"), "momentumScrollEnd", {
    nativeEvent: { contentOffset: { y: 48 * 76 } },
  });
  await fireEvent.press(screen.getByRole("button", { name: "Save" }));
  // Saving an alarm that was off turns it on, so the notice is true.
  expect(edited.saved).toEqual([
    { ...alarm, enabled: true, rule: { hour: 23, minute: 48, repeatDays: [1, 2, 3, 4, 5] } },
  ]);
  expect(toasts.at(-1)).toBe("Rings in 30 min");
});

test("a one-off date whose time has already passed asks for another instead of saving", async () => {
  const done = await openEditor({ ...newAlarm("a"), deckId: "inglês" });
  await fireEvent.press(screen.getByRole("button", { name: "Repeat, Weekdays" }));
  await fireEvent.press(screen.getByRole("button", { name: "One-off date" }));
  // Today, 07:00, which was this morning.
  await act(() => answerPicker(new Date(2026, 9, 28)));
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  screen.getByRole("button", { name: "Repeat, Today" });
  await fireEvent.press(screen.getByRole("button", { name: "Save" }));
  screen.getByText("That time has passed. Pick a later date or time.");
  expect(done.saved).toEqual([]);
});

test("an alarm without a deck asks for one instead of saving", async () => {
  const done = await openEditor(newAlarm("a"));
  await fireEvent.press(screen.getByRole("button", { name: "Save" }));
  screen.getByText("Choose a deck for the alarm.");
  expect(done.saved).toEqual([]);
});

test("Delete sits at the end of the editor and asks first", async () => {
  const done = await openEditor({ ...newAlarm("a"), deckId: "inglês" }, { saved: true });
  await fireEvent.press(screen.getByRole("button", { name: "Delete alarm" }));
  expect(alerts.at(-1)?.title).toBe("Delete this alarm?");
  await act(() => answerAlert("Cancel"));
  expect(done.deleted).toEqual([]);

  await fireEvent.press(screen.getByRole("button", { name: "Delete alarm" }));
  await act(() => answerAlert("Delete alarm"));
  expect(done).toMatchObject({ deleted: ["a"], saved: [], closed: 1 });
});

test("saving a skipped alarm reports the following occurrence and keeps the skip", async () => {
  const skip = Date.parse("2026-10-29T10:00:00Z");
  const done = await openEditor({ ...newAlarm("a"), deckId: "deck", skip }, { saved: true });
  await fireEvent.press(screen.getByRole("button", { name: "Save" }));
  expect(done.saved[0]?.skip).toBe(skip);
  expect(toasts.at(-1)).toBe("Rings in 1 d 7 h 42 min");
});

test("Cancel leaves an unchanged editor immediately, without a top bar or prompt", async () => {
  const done = await openEditor(newAlarm("a"));
  const before = alerts.length;
  expect(screen.queryByRole("header")).toBeNull();
  expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(done.closed).toBe(1);
  expect(alerts).toHaveLength(before);
});

test("Cancel and Android Back ask before discarding changes, and restoring a value clears the prompt", async () => {
  const done = await openEditor({ ...newAlarm("a"), deckId: "deck" });
  await act(() => {
    expect(pressBack()).toBe(true);
  });
  expect(done.closed).toBe(1);
  await fireEvent.press(screen.getByRole("button", { name: "Label, None" }));
  await fireEvent.changeText(screen.getByLabelText("Label"), "Work");
  await act(() => {
    expect(pressBack()).toBe(true);
  });
  // Back closes the sheet before asking to leave the editor.
  const before = alerts.length;
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(alerts.at(-1)?.title).toBe("Discard changes?");
  expect(done.closed).toBe(1);
  await act(() => answerAlert("Cancel"));
  await act(() => {
    expect(pressBack()).toBe(true);
  });
  expect(alerts).toHaveLength(before + 2);
  await act(() => answerAlert("Discard"));
  expect(done).toMatchObject({ saved: [], closed: 2 });

  await fireEvent.press(screen.getByRole("button", { name: "Label, Work" }));
  await fireEvent.changeText(screen.getByLabelText("Label"), "");
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  const after = alerts.length;
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(alerts).toHaveLength(after);
  expect(done.closed).toBe(3);
});

test("saved alarms offer Skip, Duplicate and Delete directly; new alarms offer none", async () => {
  const alarm = { ...newAlarm("a"), deckId: "deck" };
  const done = await openEditor(alarm, { saved: true, locale: "pt-BR" });
  screen.getByRole("button", { name: "Duplicar alarme" });
  screen.getByRole("button", { name: "Excluir alarme" });
  await fireEvent.press(screen.getByRole("button", { name: "Pular o próximo" }));
  screen.getByRole("button", { name: "Desfazer pulo" });
  expect(done.saved).toEqual([]);
  await fireEvent.press(screen.getByRole("button", { name: "Salvar" }));
  expect(done.saved[0]?.skip).toBe(Date.parse("2026-10-29T10:00:00Z"));

  await openEditor(alarm);
  for (const name of ["Skip next", "Duplicate alarm", "Delete alarm"])
    expect(screen.queryByRole("button", { name })).toBeNull();
});

test("reselecting the same repeat days leaves without a discard prompt", async () => {
  const alarm = newAlarm("a");
  const done = await openEditor({ ...alarm, rule: { ...alarm.rule, repeatDays: [5, 4, 3, 2, 1] } });
  const before = alerts.length;
  await fireEvent.press(screen.getByRole("button", { name: "Repeat, Weekdays" }));
  await fireEvent.press(screen.getByRole("button", { name: "Weekdays" }));
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(done.closed).toBe(1);
  expect(alerts).toHaveLength(before);
});

test("12-hour wheels expose AM/PM and preserve noon and midnight through accessibility adjustments", async () => {
  const alarm = {
    ...newAlarm("a"),
    deckId: "deck",
    rule: { hour: 23, minute: 59, repeatDays: [1, 2, 3, 4, 5] },
  };
  const done = await openEditor(alarm, { hour24: false });
  expect(screen.getByRole("adjustable", { name: "Hours" }).props.accessibilityValue.text).toBe(
    "11",
  );
  expect(screen.getByRole("adjustable", { name: "AM/PM" }).props.accessibilityValue.text).toBe(
    "PM",
  );
  await fireEvent(screen.getByRole("adjustable", { name: "Hours" }), "accessibilityAction", {
    nativeEvent: { actionName: "increment" },
  });
  // Changing the hour wheel preserves the independently selected period.
  expect(screen.getByRole("adjustable", { name: "Hours" }).props.accessibilityValue.text).toBe(
    "12",
  );
  await fireEvent(screen.getByRole("adjustable", { name: "AM/PM" }), "accessibilityAction", {
    nativeEvent: { actionName: "decrement" },
  });
  await fireEvent(screen.getByRole("adjustable", { name: "Minutes" }), "accessibilityAction", {
    nativeEvent: { actionName: "increment" },
  });
  await fireEvent.press(screen.getByRole("button", { name: "Save" }));
  expect(done.saved[0]?.rule).toEqual({ hour: 0, minute: 0, repeatDays: [1, 2, 3, 4, 5] });
});

test("24-hour scrolling wraps and rounds to whole minutes, and Save uses the current draft even before momentum ends", async () => {
  const alarm = {
    ...newAlarm("a"),
    deckId: "deck",
    rule: { hour: 23, minute: 59, repeatDays: [1, 2, 3, 4, 5] },
  };
  const done = await openEditor(alarm, { locale: "pt-BR" });
  expect(screen.queryByRole("adjustable", { name: "AM/PM" })).toBeNull();
  await fireEvent(wheelScroll("Hours"), "scroll", {
    nativeEvent: { contentOffset: { y: 72 * 76 } },
  });
  await fireEvent(wheelScroll("Minutes"), "scroll", {
    nativeEvent: { contentOffset: { y: 193.7 * 76 } },
  });
  expect(screen.getByRole("adjustable", { name: "Horas" }).props.accessibilityValue.text).toBe(
    "00",
  );
  expect(screen.getByRole("adjustable", { name: "Minutos" }).props.accessibilityValue.text).toBe(
    "14",
  );
  await fireEvent.press(screen.getByRole("button", { name: "Salvar" }));
  expect(done.saved[0]?.rule).toEqual({ hour: 0, minute: 14, repeatDays: [1, 2, 3, 4, 5] });
});

test("a slow drag settles without momentum and keeps a subsequent change to the other wheel", async () => {
  vi.useFakeTimers();
  try {
    const done = await openEditor({ ...newAlarm("a"), deckId: "deck" });
    await fireEvent(wheelScroll("Hours"), "scrollEndDrag", {
      nativeEvent: { contentOffset: { y: 8 * 76 } },
    });
    await fireEvent(wheelScroll("Minutes"), "momentumScrollEnd", {
      nativeEvent: { contentOffset: { y: 20 * 76 } },
    });
    await act(() => vi.advanceTimersByTimeAsync(150));
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(done.saved[0]?.rule).toEqual({ hour: 8, minute: 20, repeatDays: [1, 2, 3, 4, 5] });
  } finally {
    vi.useRealTimers();
  }
});

test("TalkBack's adjustable control sits outside the wheel's scroll view, which Android keeps from it", async () => {
  await openEditor({ ...newAlarm("a"), deckId: "deck" }, { hour24: false });
  for (const name of ["Hours", "Minutes", "AM/PM"]) {
    const control = screen.getByRole("adjustable", { name });
    expect(control.type).not.toBe("RCTScrollView");
    expect(wheelScroll(name).props).toMatchObject({
      accessible: false,
      importantForAccessibility: "no-hide-descendants",
    });
  }
});

test("at 1.3x font a wheel's scaled line fits its row, so the digits stay centered", async () => {
  windowDimensions.fontScale = 1.3;
  try {
    await openEditor({ ...newAlarm("a"), deckId: "deck" });
    for (const row of screen.getAllByText("07", { includeHiddenElements: true })) {
      const { lineHeight, height } = StyleSheet.flatten(row.props.style);
      // Android scales lineHeight with the font but not height.
      expect(Number(lineHeight) * 1.3).toBeLessThanOrEqual(Number(height));
    }
  } finally {
    windowDimensions.fontScale = 1;
  }
});
