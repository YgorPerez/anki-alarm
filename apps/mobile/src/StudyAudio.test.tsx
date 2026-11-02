import { Collection } from "@app/core";
import { render, screen, waitFor } from "@testing-library/react-native/pure";
import { expect, test, vi } from "vite-plus/test";
import { StudyAudio } from "./StudyAudio.tsx";

function card(front: string, back: string, options: { manual?: boolean; skip?: boolean } = {}) {
  const c = new Collection({
    deviceId: "phone",
    now: () => 1000,
    random: () => new Uint8Array(16),
  });
  const deck = c.createDeck("Words");
  c.addBasicNote(deck.id, front, back);
  c.updatePreset(deck.fields.presetId.value, {
    dontPlayAutomatically: options.manual ?? false,
    skipQuestionWhenReplayingAnswer: options.skip ?? false,
  });
  const state = c.snapshot();
  return {
    input: { note: state.notes[0]!, type: state.noteTypes[0]!, ordinal: 0 },
    preset: state.presets[0]!,
    locale: "pt-BR" as const,
  };
}
const replay = () => screen.queryByRole("button", { name: "Repetir áudio" });

test("a side with no audio hides the button and still reports finishing for auto advance", async () => {
  const onFinished = vi.fn<() => void>();
  await render(<StudyAudio {...card("casa", "house")} side="front" onFinished={onFinished} />);
  expect(replay()).toBeNull();
  await waitFor(() => expect(onFinished).toHaveBeenCalled());
});

test("audio kept from playing automatically can still be replayed", async () => {
  await render(<StudyAudio {...card("[sound:q.mp3]", "a", { manual: true })} side="front" />);
  expect(replay()).not.toBeNull();
});

test("the answer side replays the question's audio unless the preset skips it", async () => {
  await render(<StudyAudio {...card("[sound:q.mp3]", "house")} side="back" />);
  expect(replay()).not.toBeNull();
  await render(<StudyAudio {...card("[sound:q.mp3]", "house", { skip: true })} side="back" />);
  expect(replay()).toBeNull();
});
