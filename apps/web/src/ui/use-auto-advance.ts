import { useAutoAdvanceClock, type AutoAdvanceOptions } from "@app/editing-ui/use-auto-advance";
import { useSyncExternalStore } from "react";

function subscribeToVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}
const tabHidden = () => document.visibilityState === "hidden";
const visibleOnServer = () => false;

/**
 * Runs a side's auto advance while nothing holds it: leaving the page, a hold or a hidden tab
 * clears the clock.
 */
export function useAutoAdvance(options: AutoAdvanceOptions) {
  const hidden = useSyncExternalStore(subscribeToVisibility, tabHidden, visibleOnServer);
  return useAutoAdvanceClock({ ...options, held: options.held || hidden });
}
