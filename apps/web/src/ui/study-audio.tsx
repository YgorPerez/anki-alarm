/* oxlint-disable eslint/no-await-in-loop -- Card audio plays in order. */
import { studyAudio, type Preset, type ReadAloudInput } from "@app/core";
import { useEffect, useState } from "react";
import { editingCopy } from "#/editing-copy.ts";
import { Button } from "#/ui/shadcn/button.tsx";

export function StudyAudio({
  input,
  side,
  preset,
  locale,
}: {
  input: Omit<ReadAloudInput, "language">;
  side: "front" | "back";
  preset: Preset;
  locale: "pt-BR" | "en";
}) {
  const [replay, setReplay] = useState(0);
  const playback = JSON.stringify({ clips: studyAudio(input, side, preset, replay > 0), replay });
  useEffect(() => {
    let cancelled = false;
    let current: HTMLAudioElement | undefined;
    const { clips: names }: { clips: string[] } = JSON.parse(playback);
    async function play() {
      for (const name of names) {
        if (cancelled) return;
        const audio = new Audio(`/media/${encodeURIComponent(name)}`);
        current = audio;
        await new Promise<void>((resolve) => {
          audio.addEventListener("ended", () => resolve(), { once: true });
          audio.addEventListener("error", () => resolve(), { once: true });
          void audio.play().catch(() => resolve());
        });
      }
    }
    void play();
    return () => {
      cancelled = true;
      current?.pause();
    };
  }, [playback]);
  return (
    <Button variant="ghost" onClick={() => setReplay((n) => n + 1)}>
      {editingCopy(locale)("replayAudio")}
    </Button>
  );
}
