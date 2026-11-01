import type { AutoAdvanceStep } from "@app/core";
import { useEffect, useRef, useState } from "react";

export interface AutoAdvanceOptions {
  /** Which card and side is showing. */
  side: string | undefined;
  step: AutoAdvanceStep | undefined;
  held: boolean;
  audioFinished: boolean;
  run: (action: Exclude<AutoAdvanceStep["action"], "showReminder">) => void;
}

/** A side's auto advance clock: it runs while nothing holds it, and leaving the screen clears it. */
export function useAutoAdvanceClock({ side, step, held, audioFinished, run }: AutoAdvanceOptions) {
  const [reminded, setReminded] = useState<string>();
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  });
  const armed = step && !held && (!step.waitForAudio || audioFinished);
  const delayMs = armed ? step.delayMs : undefined;
  const action = step?.action;
  useEffect(() => {
    if (delayMs === undefined || !action) return undefined;
    const clock = setTimeout(() => {
      if (action === "showReminder") setReminded(side);
      else latest.current(action);
    }, delayMs);
    return () => {
      clearTimeout(clock);
      setReminded(undefined);
    };
  }, [action, delayMs, side]);
  return { reminder: Boolean(side && reminded === side) };
}
