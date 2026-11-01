import type { AutoAdvanceStep } from "@app/core";
import { useEffect, useRef, useState } from "react";

type Action = Exclude<AutoAdvanceStep["action"], "showReminder">;

/**
 * Runs a side's auto advance while nothing holds it: leaving the page, a hold or a hidden tab
 * clears the clock.
 */
export function useAutoAdvance({
  side,
  step,
  held,
  audioFinished,
  run,
}: {
  /** Which card and side is showing. */
  side: string | undefined;
  step: AutoAdvanceStep | undefined;
  held: boolean;
  audioFinished: boolean;
  run: (action: Action) => void;
}) {
  const [hidden, setHidden] = useState(() => document.visibilityState === "hidden");
  const [reminded, setReminded] = useState<string>();
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  });
  useEffect(() => {
    const change = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  const armed = step && !held && !hidden && (!step.waitForAudio || audioFinished);
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
