/* oxlint-disable eslint/no-await-in-loop -- Presses land one after another, as a thumb does them. */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native/pure";
import { expect, test, vi } from "vite-plus/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Effect } from "effect";
import { MAX_NEED, newAlarm, type Alarm, type Locale } from "@app/core";
import { pressBack } from "../test/native/react-native.ts";
import { localData } from "./database.ts";
import { AlarmEditorScreen } from "./AlarmEditorScreen.tsx";
import { AlarmSettingsRows } from "./AlarmSettingsRows.tsx";

const audio = vi.hoisted(() => ({
  previewSound: vi.fn<(sound: string) => void>(),
  stopPreview: vi.fn<() => void>(),
  pickSound:
    vi.fn<(kind: "ringtone" | "file", currentUri: string | null) => Promise<string | null>>(),
}));
vi.mock("../modules/alarm-native/index.ts", () => ({ default: audio }));

async function editor(locale: Locale = "en") {
  const collection = await Effect.runPromise(
    localData((data) => data.changeCollection((c) => void c.createDeck("Inglês::Verbos"))),
  );
  const deckId = collection.decks.find((d) => d.fields.name.value === "Inglês::Verbos")!.id;
  const saved: Alarm[] = [];
  await render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AlarmEditorScreen
        alarm={{ ...newAlarm("rows"), deckId }}
        saved
        locale={locale}
        hour24
        onSave={async (alarm) => {
          saved.push(alarm);
        }}
        onDelete={async () => {}}
        onClose={() => {}}
        options={(alarm, onChange) => (
          <AlarmSettingsRows alarm={alarm} locale={locale} onChange={onChange} />
        )}
      />
    </QueryClientProvider>,
  );
  return saved;
}

test("the cards block chooses the deck in a sheet and sets N on the page", async () => {
  const saved = await editor();
  const deck = await screen.findByRole("button", { name: "Cards from, Inglês::Verbos" });
  expect(screen.getByText("Inglês::Verbos").props.numberOfLines).toBe(2);
  await fireEvent.press(deck);
  screen.getByRole("radio", { name: "Inglês::Verbos", checked: true });
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  expect(screen.queryByRole("radio")).toBeNull();

  await fireEvent.press(screen.getByRole("button", { name: "More cards" }));
  screen.getByLabelText("4 cards");
  expect(screen.queryByRole("radio")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Save" }));
  expect(saved[0]).toMatchObject({ need: 4, deckId: expect.any(String) });
});

test("the card stepper stops at Core's limits", async () => {
  const saved = await editor();
  const fewer = await screen.findByRole("button", { name: "Fewer cards" });
  const more = screen.getByRole("button", { name: "More cards" });
  for (let i = 0; i < 5; i++) await fireEvent.press(fewer);
  screen.getByLabelText("1 cards");
  screen.getByRole("button", { name: "Fewer cards", disabled: true });
  for (let i = 0; i < MAX_NEED + 5; i++) await fireEvent.press(more);
  screen.getByLabelText(`${MAX_NEED} cards`);
  screen.getByRole("button", { name: "More cards", disabled: true });
  await fireEvent.press(screen.getByRole("button", { name: "Save" }));
  expect(saved[0]?.need).toBe(MAX_NEED);
});

test("switches flip a setting on the page; a row tap opens its sheet", async () => {
  const saved = await editor();
  expect(screen.queryByLabelText("Sound")).toBeNull();
  await fireEvent(screen.getByLabelText("Vibration"), "valueChange", false);
  screen.getByRole("button", { name: "Vibration, Disabled" });
  await fireEvent(screen.getByLabelText("Snooze"), "valueChange", false);
  screen.getByRole("button", { name: "Snooze, Disabled" });
  await fireEvent(screen.getByLabelText("Awake check"), "valueChange", true);
  screen.getByRole("button", { name: /^Awake check, \d+ min$/ });
  await fireEvent(screen.getByLabelText("Read aloud"), "valueChange", true);
  screen.getByRole("button", { name: "Read aloud, Enabled" });
  expect(screen.queryByRole("button", { name: "Done" })).toBeNull();

  await fireEvent.press(screen.getByRole("button", { name: "Vibration, Disabled" }));
  screen.getByRole("header", { name: "Vibration" });
  await fireEvent(screen.getAllByLabelText("Vibration").at(-1)!, "valueChange", true);
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  screen.getByRole("button", { name: "Vibration, Enabled" });

  await fireEvent.press(screen.getByRole("button", { name: "Save" }));
  expect(saved[0]).toMatchObject({
    vibrate: true,
    snooze: false,
    awakeCheck: true,
    readAloud: true,
  });
});

test("Sound, Snooze, Awake check and Read aloud show draft changes and save them", async () => {
  const saved = await editor();
  await fireEvent.press(screen.getByRole("button", { name: /^Sound, / }));
  await fireEvent.press(screen.getByRole("radio", { name: "Chimes" }));
  await fireEvent.press(screen.getByRole("radio", { name: "30 seconds" }));
  // The vibration switch left this sheet: only the row's stays on screen.
  expect(screen.getAllByLabelText("Vibration")).toHaveLength(1);
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  screen.getByRole("button", { name: "Sound, Chimes · 30 seconds" });

  await fireEvent.press(screen.getByRole("button", { name: /^Snooze, / }));
  await fireEvent(screen.getByLabelText("Allow snooze"), "valueChange", true);
  await fireEvent.press(screen.getByRole("radio", { name: "15 min" }));
  await fireEvent.press(screen.getByRole("button", { name: "More snoozes" }));
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  screen.getByRole("button", { name: "Snooze, 15 min · 3 snoozes" });

  await fireEvent.press(screen.getByRole("button", { name: /^Awake check, / }));
  await fireEvent(screen.getAllByLabelText("Awake check").at(-1)!, "valueChange", true);
  await fireEvent.press(screen.getByRole("radio", { name: "10 min" }));
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  screen.getByRole("button", { name: "Awake check, 10 min" });

  await fireEvent.press(screen.getByRole("button", { name: "Read aloud, Disabled" }));
  await fireEvent(screen.getAllByLabelText("Read aloud").at(-1)!, "valueChange", true);
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  screen.getByRole("button", { name: "Read aloud, Enabled" });
  await fireEvent.press(screen.getByRole("button", { name: "Save" }));
  expect(saved[0]).toMatchObject({
    sound: { kind: "bundled", id: "chimes" },
    rampSeconds: 30,
    snooze: true,
    snoozeMinutes: 15,
    snoozeCap: 3,
    awakeCheck: true,
    awakeCheckMinutes: 10,
    readAloud: true,
  });
});

test("sound preview uses the selection and stops on another choice, Done, Back and leaving the editor", async () => {
  await editor();
  await fireEvent.press(screen.getByRole("button", { name: /^Sound, / }));
  await fireEvent.press(screen.getByRole("button", { name: "Preview sound" }));
  expect(audio.previewSound).toHaveBeenLastCalledWith('{"kind":"bundled","id":"dawn"}');
  audio.stopPreview.mockClear();
  await fireEvent.press(screen.getByRole("radio", { name: "Chimes" }));
  expect(audio.stopPreview).toHaveBeenCalled();

  const file = { kind: "file", uri: "content://audio/42", title: "Morning" };
  audio.pickSound.mockResolvedValueOnce(JSON.stringify(file));
  await fireEvent.press(screen.getByRole("button", { name: "Choose audio file" }));
  await screen.findByText("Morning");
  await fireEvent.press(screen.getByRole("button", { name: "Preview sound" }));
  expect(audio.previewSound).toHaveBeenLastCalledWith(JSON.stringify(file));
  audio.stopPreview.mockClear();
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  expect(audio.stopPreview).toHaveBeenCalled();
  screen.getByRole("button", { name: /^Sound, Morning/ });
  await fireEvent.press(screen.getByRole("button", { name: /^Sound, / }));
  await fireEvent.press(screen.getByRole("button", { name: "Preview sound" }));
  audio.stopPreview.mockClear();
  await act(() => {
    expect(pressBack()).toBe(true);
  });
  expect(audio.stopPreview).toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Preview sound" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: /^Sound, / }));
  await fireEvent.press(screen.getByRole("button", { name: "Preview sound" }));
  audio.stopPreview.mockClear();
  await cleanup();
  expect(audio.stopPreview).toHaveBeenCalled();
});

test("settings rows and sheets use Portuguese and show disabled options", async () => {
  await editor("pt-BR");
  await screen.findByRole("button", { name: "Cartões de, Inglês::Verbos" });
  screen.getByLabelText("3 cartões");
  screen.getByRole("button", { name: /^Som, Amanhecer/ });
  screen.getByRole("button", { name: "Vibração, Ativada" });
  screen.getByRole("button", { name: /^Adiar, / });
  screen.getByRole("button", { name: /^Teste de despertar, / });
  screen.getByRole("button", { name: "Ler em voz alta, Desativado" });
  await fireEvent.press(screen.getByRole("button", { name: /^Adiar, / }));
  await fireEvent(screen.getByLabelText("Permitir adiar"), "valueChange", false);
  await fireEvent.press(screen.getByRole("button", { name: "Pronto" }));
  expect(screen.getByRole("button", { name: "Adiar, Desativado" })).toBeDefined();
});
