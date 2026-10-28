import { QueryClient } from "@tanstack/react-query";

import { webData } from "./data/client.ts";

/** Queries read the local database, which answers offline too. */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { networkMode: "always", retry: false } },
});

/** For an effect in the root: any tab's write, or a sync that changed something, refreshes all. */
export const followData = () =>
  webData().subscribe(() => {
    // The storage error is set by hand, not read: a refresh would clear it.
    void queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[0] !== "storage-error",
    });
  });
