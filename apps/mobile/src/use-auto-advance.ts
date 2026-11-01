import { useAutoAdvanceClock, type AutoAdvanceOptions } from "@app/editing-ui/use-auto-advance";
import { useEffect, useState } from "react";
import { AppState } from "react-native";

/**
 * Runs a side's auto advance while the screen is `held` by nothing: unmounting, a hold or the app
 * leaving the foreground clears the clock. Only normal study mounts this, never an alarm session.
 */
export function useAutoAdvance(options: AutoAdvanceOptions) {
  const [background, setBackground] = useState(false);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setBackground(state !== "active"),
    );
    return () => subscription.remove();
  }, []);
  return useAutoAdvanceClock({ ...options, held: options.held || background });
}
