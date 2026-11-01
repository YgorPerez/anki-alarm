import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { AppState } from "react-native";
import type { AnkiDroidApi } from "./ankidroid.ts";
import { autoSyncBack } from "./ankidroid-sync-query.ts";

export function AnkiDroidAutoSync({ ankiDroid }: { ankiDroid: AnkiDroidApi }) {
  const client = useQueryClient();
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background") void autoSyncBack(ankiDroid, client);
    });
    return () => subscription.remove();
  }, [ankiDroid, client]);
  return null;
}
