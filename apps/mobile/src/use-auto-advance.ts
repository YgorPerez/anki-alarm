import type { AutoAdvanceStep } from "@app/core";
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

type Action = Exclude<AutoAdvanceStep["action"], "showReminder">;

/**
 * Runs a side's auto advance while the screen is `held` by nothing: unmounting, a hold or the app
 * leaving the foreground clears the clock. Only normal study mounts this, never an alarm session.
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
  const [background, setBackground] = useState(false);
  const [reminded, setReminded] = useState<string>();
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  });
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setBackground(state !== "active"),
    );
    return () => subscription.remove();
  }, []);
  const armed = step && !held && !background && (!step.waitForAudio || audioFinished);
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
