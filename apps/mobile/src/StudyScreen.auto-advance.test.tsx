import { changeAppState } from "../test/native/react-native.ts";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native/pure";
import { expect, test } from "vite-plus/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Effect } from "effect";
import type { PresetOptions } from "@app/core";
import { localData } from "./database.ts";
import { StudyScreen } from "./StudyScreen.tsx";

const SOON = 0.01;
const DONE = "No cards available now. Daily limits apply.";
const longerThanSoon = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 150)));
const reviews = async (cardId: string) => {
  const log = await Effect.runPromise(localData((data) => data.reviewLog));
  return log.filter((e) => e.kind === "review" && e.cardId === cardId);
};

async function study(name: string, options: Partial<PresetOptions>, front = "front") {
  const state = await Effect.runPromise(
    localData((data) =>
      data.changeCollection((c) => {
        const deck = c.createDeck(name);
        const preset = c.createPreset(`${name} preset`);
        c.setDeckPreset(deck.id, preset.id);
        c.updatePreset(preset.id, options);
        c.addBasicNote(deck.id, `${name} ${front}`, "back");
      }),
    ),
  );
  const deck = state.decks.find((d) => d.fields.name.value === name)!;
  const card = state.cards.find((c) => c.fields.deckId.value === deck.id)!;
  const view = await render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <StudyScreen deckId={deck.id} locale="en" onExit={() => {}} />
    </QueryClientProvider>,
  );
  return { view, cardId: card.id };
}

test("without seconds the card waits for the user", async () => {
  const { view } = await study("Off", {});
  await screen.findByLabelText("Front");
  await longerThanSoon();
  expect(screen.getByLabelText("Front")).toBeTruthy();
  await view.unmount();
});

test("the question shows the answer and the answer grades by itself", async () => {
  const { view, cardId } = await study("Runs", {
    secondsToShowQuestion: SOON,
    secondsToShowAnswer: SOON,
    waitForAudio: false,
    answerAction: "good",
  });
  await screen.findByText(DONE);
  expect(await reviews(cardId)).toMatchObject([{ grade: 3 }]);
  await view.unmount();
});

test.each([
  ["again", 1],
  ["hard", 2],
] as const)("the answer action %s grades %i", async (answerAction, grade) => {
  const { view, cardId } = await study(`Grade ${answerAction}`, {
    secondsToShowAnswer: SOON,
    waitForAudio: false,
    answerAction,
  });
  await fireEvent.press(await screen.findByRole("button", { name: "Show answer" }));
  await waitFor(async () => expect(await reviews(cardId)).toMatchObject([{ grade }]));
  await view.unmount();
});

test("the bury action takes the card out without a review", async () => {
  const { view, cardId } = await study("Buried", {
    secondsToShowQuestion: SOON,
    secondsToShowAnswer: SOON,
    waitForAudio: false,
    answerAction: "bury",
  });
  await screen.findByText(DONE);
  expect(await reviews(cardId)).toEqual([]);
  await view.unmount();
});

test("reminders tell the user and leave the card where it is", async () => {
  const { view, cardId } = await study("Reminded", {
    secondsToShowQuestion: SOON,
    secondsToShowAnswer: SOON,
    waitForAudio: false,
    questionAction: "showReminder",
    answerAction: "showReminder",
  });
  await screen.findByText("Time to show the answer");
  screen.getByLabelText("Front");
  await fireEvent.press(screen.getByRole("button", { name: "Show answer" }));
  expect(screen.queryByText("Time to show the answer")).toBeNull();
  await screen.findByText("Time to answer");
  screen.getByLabelText("Back");
  expect(await reviews(cardId)).toEqual([]);
  await view.unmount();
});

test("waiting for audio starts the seconds when the side's audio ends", async () => {
  const { view } = await study(
    "Audio",
    { secondsToShowQuestion: SOON, questionAction: "showAnswer" },
    "[sound:q.mp3]",
  );
  await screen.findByLabelText("Front");
  await longerThanSoon();
  screen.getByLabelText("Front");
  await fireEvent(screen.getByTestId("study-audio"), "message", {
    nativeEvent: { data: "audio-finished" },
  });
  expect(await screen.findByLabelText("Back")).toBeTruthy();
  await view.unmount();
});

test("a side with no audio to wait for starts the seconds at once", async () => {
  const { view } = await study("Silent", { secondsToShowQuestion: SOON });
  expect(await screen.findByLabelText("Back")).toBeTruthy();
  await view.unmount();
});

test("leaving study stops it", async () => {
  const { view, cardId } = await study("Left", {
    secondsToShowQuestion: 0.5,
    secondsToShowAnswer: SOON,
    waitForAudio: false,
    answerAction: "good",
  });
  await view.unmount();
  await new Promise((resolve) => setTimeout(resolve, 800));
  expect(await reviews(cardId)).toEqual([]);
});

test("the card menu and the note editor hold it", async () => {
  const { view, cardId } = await study("Held", {
    secondsToShowAnswer: 1,
    waitForAudio: false,
    answerAction: "good",
  });
  await fireEvent.press(await screen.findByRole("button", { name: "Show answer" }));
  await fireEvent.press(screen.getByRole("button", { name: "Card actions" }));
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 1200)));
  expect(await reviews(cardId)).toEqual([]);
  await fireEvent.press(screen.getByRole("button", { name: "Edit note" }));
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 1200)));
  expect(await reviews(cardId)).toEqual([]);
  await view.unmount();
});

test("putting the app in the background holds it until the app returns", async () => {
  const { view } = await study("Background", {
    secondsToShowQuestion: 1,
    waitForAudio: false,
  });
  await screen.findByLabelText("Front");
  await act(async () => changeAppState("background"));
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 1200)));
  screen.getByLabelText("Front");
  await act(async () => changeAppState("active"));
  expect(await screen.findByLabelText("Back", {}, { timeout: 3000 })).toBeTruthy();
  await view.unmount();
});
