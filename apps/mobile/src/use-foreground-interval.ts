import { useEffect, useRef } from "react";
import { AppState } from "react-native";

/** Calls `tick` at once and on an interval while enabled and the app is in the foreground. */
export function useForegroundInterval(enabled: boolean, tick: () => void, intervalMs: number) {
  const latest = useRef(tick);
  useEffect(() => {
    latest.current = tick;
  }, [tick]);
  useEffect(() => {
    if (!enabled) return undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    const follow = (state: string | null | undefined) => {
      clearInterval(timer);
      timer = undefined;
      if (state !== "active") return;
      latest.current();
      timer = setInterval(() => latest.current(), intervalMs);
    };
    follow(AppState.currentState);
    const subscription = AppState.addEventListener("change", follow);
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [enabled, intervalMs]);
}
