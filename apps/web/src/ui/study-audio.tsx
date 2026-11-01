/* oxlint-disable eslint/no-await-in-loop -- Card audio plays in order. */
import { studyAudio, type Locale, type Preset, type ReadAloudInput } from "@app/core";
import { useEffect, useRef, useState } from "react";
import { editingCopy } from "#/editing-copy.ts";
import { Button } from "#/ui/shadcn/button.tsx";

export function StudyAudio({
  input,
  side,
  preset,
  locale,
  onPlaying,
  onFinished,
}: {
  input: Omit<ReadAloudInput, "language">;
  side: "front" | "back";
  preset: Preset;
  locale: Locale;
  /** A replay started. */
  onPlaying?: () => void;
  /** The side's audio ended, or it had none. */
  onFinished?: () => void;
}) {
  const [replay, setReplay] = useState(0);
  const playback = JSON.stringify({ clips: studyAudio(input, side, preset, replay > 0), replay });
  const finished = useRef(onFinished);
  useEffect(() => {
    finished.current = onFinished;
  });
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
      if (!cancelled) finished.current?.();
    }
    void play();
    return () => {
      cancelled = true;
      current?.pause();
    };
  }, [playback]);
  return (
    <Button
      variant="ghost"
      onClick={() => {
        onPlaying?.();
        setReplay((n) => n + 1);
      }}
    >
      {editingCopy(locale)("replayAudio")}
    </Button>
  );
}
