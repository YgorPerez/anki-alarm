// The phone's one sync controller. After a sync that changed something, the screens' queries
// refresh, the theme (and its native splash/alarm mirror) re-applies, and Home re-arms alarms.
import { Effect } from "effect";

import { phoneAccount } from "./auth.ts";
import { localData } from "./database.ts";
import { queryClient } from "./query.ts";
import { createSync } from "./sync.ts";
import { initializeTheme } from "./theme.ts";
import { fetchOtaInBackground } from "./updates.ts";

export const appSync = phoneAccount
  ? createSync({ account: phoneAccount, data: (use) => Effect.runPromise(localData(use)) })
  : null;

appSync?.onSynced(({ changed }) => {
  if (changed.length === 0) return;
  void queryClient.invalidateQueries({ queryKey: ["collection"] });
  void queryClient.invalidateQueries({ queryKey: ["study"] });
  if (changed.includes("settings")) {
    void queryClient.invalidateQueries({ queryKey: ["settings"] }).then(initializeTheme);
  }
});

// A protocol mismatch: fetch the OTA now, so the next cold start applies it (never mid-session).
// Home's update offer covers a release that needs a new APK.
let fetched = false;
appSync?.subscribe(() => {
  const state = appSync.state();
  if (fetched || state.kind !== "signedIn" || state.sync.kind !== "updateRequired") return;
  fetched = true;
  void fetchOtaInBackground();
});
