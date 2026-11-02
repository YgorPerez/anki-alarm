import { Collection } from "@app/core";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vite-plus/test";
import { StudyAudio } from "./study-audio.tsx";

test("replay follows the preset even when automatic playback is off", async () => {
  const c = new Collection({ deviceId: "web", now: () => 1000, random: () => new Uint8Array(16) });
  const deck = c.createDeck("Words");
  c.addBasicNote(deck.id, "[sound:q.mp3]", "[sound:a.mp3]");
  c.updatePreset(deck.fields.presetId.value, {
    dontPlayAutomatically: true,
    skipQuestionWhenReplayingAnswer: true,
  });
  const state = c.snapshot();
  const played: string[] = [];
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    played.push(this.src);
    return Promise.resolve();
  });
  try {
    render(
      <StudyAudio
        input={{ note: state.notes[0]!, type: state.noteTypes[0]!, ordinal: 0 }}
        side="back"
        preset={state.presets[0]!}
        locale="en"
      />,
    );
    expect(played).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Replay audio" }));
    await waitFor(() =>
      expect(played.map((url) => new URL(url).pathname)).toEqual(["/media/a.mp3"]),
    );
    fireEvent.click(screen.getByRole("button", { name: "Replay audio" }));
    await waitFor(() => expect(played).toHaveLength(2));
  } finally {
    play.mockRestore();
  }
});

test("a side with nothing to play has no replay button and still finishes", async () => {
  const c = new Collection({ deviceId: "web", now: () => 1000, random: () => new Uint8Array(16) });
  const deck = c.createDeck("Words");
  c.addBasicNote(deck.id, "casa", "house");
  const state = c.snapshot();
  const onFinished = vi.fn<() => void>();
  render(
    <StudyAudio
      input={{ note: state.notes[0]!, type: state.noteTypes[0]!, ordinal: 0 }}
      side="front"
      preset={state.presets[0]!}
      locale="en"
      onFinished={onFinished}
    />,
  );
  expect(screen.queryByRole("button", { name: "Replay audio" })).toBeNull();
  await waitFor(() => expect(onFinished).toHaveBeenCalled());
});
