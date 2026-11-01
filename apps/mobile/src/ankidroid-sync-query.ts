import { useQuery, type QueryClient } from "@tanstack/react-query";
import { Effect } from "effect";
import { localData } from "./database.ts";
import { syncBackAfterSession, type AnkiDroidApi } from "./ankidroid.ts";

export const ANKIDROID_SYNC_QUERY_KEY = ["ankiDroidSyncBackStatus"] as const;
export function useAnkiDroidSyncBackStatus() {
  return useQuery({
    queryKey: ANKIDROID_SYNC_QUERY_KEY,
    queryFn: () => Effect.runPromise(localData((data) => data.ankiDroidSyncBackStatus)),
  });
}

/** Every automatic trigger uses this path, including its visible failure and refreshed counts. */
export async function autoSyncBack(api: AnkiDroidApi, client: QueryClient) {
  try {
    await Effect.runPromise(syncBackAfterSession(api));
    await Promise.all(
      [ANKIDROID_SYNC_QUERY_KEY, ["collection"], ["reviewLog"], ["study"]].map((queryKey) =>
        client.invalidateQueries({ queryKey }),
      ),
    );
  } catch {
    // Even a storage failure that prevented recording the reason must remain visible.
    client.setQueryData(ANKIDROID_SYNC_QUERY_KEY, { pending: [], failure: "failed" });
  }
}
