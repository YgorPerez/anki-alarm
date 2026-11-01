import type { PresetOptions } from "@app/core";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vite-plus/test";

import { webRequest } from "#/data/client.ts";

import { renderRoute } from "../../test/render.tsx";

const SOON = 0.01;
const wait = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

async function study(name: string, options: Partial<PresetOptions>, front = "front") {
  const deckId = (await webRequest("change", { kind: "createDeck", name }))!;
  const presetId = (await webRequest("change", {
    kind: "createPreset",
    name: `${name} preset`,
    deckId,
  }))!;
  await webRequest("change", { kind: "updatePreset", id: presetId, patch: options });
  await webRequest("change", { kind: "addNote", deckId, noteTypeId: "", values: [front, "back"] });
  const { cards } = await webRequest("collection");
  const cardId = cards.find((c) => c.fields.deckId.value === deckId)!.id;
  await renderRoute(`/study?deck=${deckId}&lang=en`);
  return {
    reviews: async () =>
      (await webRequest("reviewLog")).filter((e) => e.kind === "review" && e.cardId === cardId),
  };
}

test("the question shows the answer and the answer grades by itself", async () => {
  const { reviews } = await study("Web runs", {
    secondsToShowQuestion: SOON,
    secondsToShowAnswer: SOON,
    waitForAudio: false,
    answerAction: "hard",
  });
  // Hard keeps a new card in the session, so it can come back and advance again.
  await waitFor(async () => expect((await reviews())[0]).toMatchObject({ grade: 2 }));
});

test("the bury action takes the card out without a review", async () => {
  const { reviews } = await study("Web buried", {
    secondsToShowQuestion: SOON,
    secondsToShowAnswer: SOON,
    waitForAudio: false,
    answerAction: "bury",
  });
  await screen.findByText("No cards available now. Daily limits apply.");
  expect(await reviews()).toEqual([]);
});

test("reminders tell the user and leave the card where it is", async () => {
  const { reviews } = await study("Web reminded", {
    secondsToShowQuestion: SOON,
    secondsToShowAnswer: SOON,
    waitForAudio: false,
    questionAction: "showReminder",
    answerAction: "showReminder",
  });
  await screen.findByText("Time to show the answer");
  await act(async () => screen.getByRole("button", { name: "Show answer" }).click());
  await screen.findByText("Time to answer");
  expect(screen.queryByText("Time to show the answer")).toBeNull();
  expect(await reviews()).toEqual([]);
});

test("waiting for audio starts the seconds when the side's audio ends", async () => {
  const playing: HTMLMediaElement[] = [];
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    playing.push(this);
    return Promise.resolve();
  });
  try {
    await study("Web audio", { secondsToShowQuestion: SOON }, "[sound:q.mp3]");
    await waitFor(() => expect(playing).toHaveLength(1));
    await wait(150);
    screen.getByRole("button", { name: "Show answer" });
    await act(async () => playing[0]!.dispatchEvent(new Event("ended")));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Show answer" })).toBeNull());
  } finally {
    play.mockRestore();
  }
});

test("leaving study stops it", async () => {
  const { reviews } = await study("Web left", {
    secondsToShowQuestion: 0.5,
    secondsToShowAnswer: SOON,
    waitForAudio: false,
    answerAction: "good",
  });
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 800));
  expect(await reviews()).toEqual([]);
});

test("a hidden tab holds it until the tab returns", async () => {
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  try {
    await study("Web hidden", { secondsToShowQuestion: SOON, waitForAudio: false });
    const reveal = await screen.findByRole("button", { name: "Show answer" });
    await wait(150);
    expect(reveal.isConnected).toBe(true);
    visibility.mockReturnValue("visible");
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Show answer" })).toBeNull());
  } finally {
    visibility.mockRestore();
  }
});

test("deck options save the auto advance controls", async () => {
  const id = (await webRequest("change", { kind: "createDeck", name: "Web options" }))!;
  const { user } = await renderRoute(`/deck?deck=${id}&options=true&lang=en`);
  const question = await screen.findByLabelText("Seconds to show question (0 turns it off)");
  await user.clear(question);
  await user.type(question, "2.5");
  await user.click(screen.getByRole("checkbox", { name: "Wait for audio" }));
  await user.selectOptions(screen.getByLabelText("Question action"), "Show reminder");
  await user.selectOptions(screen.getByLabelText("Answer action"), "Answer Hard");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Saved.");
  const { decks, presets } = await webRequest("collection");
  const deck = decks.find((d) => d.id === id)!;
  expect(presets.find((p) => p.id === deck.fields.presetId.value)?.fields).toMatchObject({
    secondsToShowQuestion: { value: 2.5 },
    waitForAudio: { value: false },
    questionAction: { value: "showReminder" },
    answerAction: { value: "hard" },
  });
});
