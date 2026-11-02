/* oxlint-disable eslint/no-await-in-loop -- Card audio plays in order. */
import { useStudyAudio, type StudyAudioProps } from "@app/editing-ui/use-study-audio";
import { useEffect } from "react";
import { editingCopy } from "#/editing-copy.ts";
import { Button } from "#/ui/shadcn/button.tsx";

export function StudyAudio(props: StudyAudioProps) {
  const { clips, canReplay, replay, finished, startReplay } = useStudyAudio(props);
  const playback = JSON.stringify({ clips, replay });
  useEffect(() => {
    let cancelled = false;
    let current: HTMLAudioElement | undefined;
    const { clips: names }: { clips: string[] } = JSON.parse(playback);
    async function play() {
      for (const name of names) {
        if (cancelled) return;
        const audio = new Audio(`/media/${encodeURIComponent(name)}`);
        current = audio;
        // react-doctor-disable-next-line react-doctor/async-await-in-loop -- A card's clips play one after another, each starting when the last ends.
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
  }, [playback, finished]);
  if (!canReplay) return null;
  return (
    <Button variant="ghost" onClick={startReplay}>
      {editingCopy(props.locale)("replayAudio")}
    </Button>
  );
}
