import { useEffect, useState } from "react";
import { studyAnswerDuration, type Preset } from "@app/core";

/** One clock for both the displayed and logged time; revealing can freeze it. */
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
    preset && started !== undefined
      ? studyAnswerDuration(preset, (end ?? performance.now()) - started)
      : 0;
  const elapsed =
    preset && started !== undefined ? studyAnswerDuration(preset, (end ?? now) - started) : 0;
  const stop = () => {
    if (preset?.fields.stopTimerOnAnswer.value) setStopped({ started, at: performance.now() });
  };
  return { duration, seconds: Math.floor(elapsed / 1000), show, stop };
}
