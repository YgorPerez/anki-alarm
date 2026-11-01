import { Collection, type PresetOptions } from "@app/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native/pure";
import { expect, test, vi } from "vite-plus/test";
import { DeckOptionsEditor } from "./DeckOptionsEditor.tsx";

test("audio and timer controls save the edited preset", async () => {
  const c = new Collection({
    deviceId: "phone",
    now: () => 1000,
    random: () => new Uint8Array(16),
  });
  c.createDeck("Words");
  const save = vi.fn<(options: PresetOptions) => void>();
  await render(
    <DeckOptionsEditor
      preset={c.snapshot().presets[0]!}
      deckCount={1}
      locale="en"
      busy={false}
      onSave={save}
      onCancel={() => {}}
    />,
  );
  await fireEvent(screen.getByLabelText("Don't play automatically"), "valueChange", true);
  await fireEvent(
    screen.getByLabelText("Skip question when replaying answer"),
    "valueChange",
    true,
  );
  await fireEvent(screen.getByLabelText("Show timer"), "valueChange", true);
  await fireEvent(screen.getByLabelText("Stop timer on answer"), "valueChange", true);
  await fireEvent.changeText(screen.getByLabelText("Maximum answer seconds"), "17");
  await fireEvent.press(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        dontPlayAutomatically: true,
        skipQuestionWhenReplayingAnswer: true,
        showTimer: true,
        stopTimerOnAnswer: true,
        maximumAnswerSeconds: 17,
      }),
    ),
  );
});
