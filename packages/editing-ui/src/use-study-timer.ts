import { useEffect, useState } from "react";
import { studyAnswerDuration, type Preset } from "@app/core";

/**
 * The study timer, as in Anki: the logged time runs from the question to the grade, capped by the
 * preset's maximum answer seconds. "Stop on answer" only freezes the time on screen.
 */
export function useStudyTimer(started: number | undefined, preset: Preset | undefined) {
  const [stopped, setStopped] = useState<{ started: number | undefined; at: number }>();
  const [now, setNow] = useState(() => performance.now());
  const end = stopped?.started === started ? stopped?.at : undefined;
  const show = preset?.fields.showTimer.value;
  useEffect(() => {
    if (!show || end !== undefined) return undefined;
    const timer = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(timer);
  }, [show, end]);
  const duration = () =>
    preset && started !== undefined ? studyAnswerDuration(preset, performance.now() - started) : 0;
  const elapsed =
    preset && started !== undefined ? studyAnswerDuration(preset, (end ?? now) - started) : 0;
  const stop = () => {
    if (preset?.fields.stopTimerOnAnswer.value) setStopped({ started, at: performance.now() });
  };
  return { duration, seconds: Math.floor(elapsed / 1000), show, stop };
}
