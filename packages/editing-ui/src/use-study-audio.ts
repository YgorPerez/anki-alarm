import { studyAudio, type Locale, type Preset, type ReadAloudInput } from "@app/core";
import { useEffect, useRef, useState } from "react";

export interface StudyAudioProps {
  input: Omit<ReadAloudInput, "language">;
  side: "front" | "back";
  preset: Preset;
  locale: Locale;
  /** A replay started. */
  onPlaying?: () => void;
  /** The side's audio ended, or it had none. */
  onFinished?: () => void;
}

/** Which clips a side plays, and the replay that plays them again. */
export function useStudyAudio({ input, side, preset, onPlaying, onFinished }: StudyAudioProps) {
  const [replay, setReplay] = useState(0);
  const finished = useRef(onFinished);
  useEffect(() => {
    finished.current = onFinished;
  });
  return {
    clips: studyAudio(input, side, preset, replay > 0),
    /** A replay would play something, even when automatic playback is off. */
    canReplay: studyAudio(input, side, preset, true).length > 0,
    replay,
    finished,
    startReplay: () => {
      onPlaying?.();
      setReplay((n) => n + 1);
    },
  };
}
