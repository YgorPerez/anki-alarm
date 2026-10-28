// The web's account controller: client-data's `accountSync`, with the database (and the sync
// itself) in the leader tab's Worker. Sync runs on load and window focus, throttled with Pacer, when
// the browser is back online, and a few seconds after this tab's writes.
import { accountSync, type AccountState, type AccountSync } from "@app/client-data";
import { Throttler } from "@tanstack/pacer";
import { useSyncExternalStore } from "react";

import { webAccount } from "./auth.ts";
import { webData } from "./data/client.ts";

/** At most one focus-triggered sync this often. */
const FOCUS_WAIT_MS = 15_000;

let instance: AccountSync | undefined;
/** The tab's controller, made on first use in the browser; null in a build without sync. */
export const webSync = () => {
  if (!webAccount) return null;
  instance ??= accountSync({
    account: webAccount,
    data: {
      syncAccount: () => webData().request("syncAccount"),
      adoptAccount: (userId) => webData().request("adoptAccount", userId),
      sync: () => webData().request("sync"),
      subscribe: webData().onLocalWrite,
    },
  });
  return instance;
};

/** For an effect in the root: picks up the session on load and syncs again on focus. */
export const followSync = () => {
  const sync = webSync();
  if (!sync) return () => {};
  const throttler = new Throttler(
    () => {
      const state = sync.state();
      if (state.kind === "signedIn") sync.syncNow();
      // Not signed in yet (or the network was down on load): look for the session again.
      else if (state.kind === "loading" || (state.kind === "signedOut" && !state.busy))
        void sync.start();
    },
    { wait: FOCUS_WAIT_MS, trailing: false },
  );
  throttler.maybeExecute();
  const onFocus = () => throttler.maybeExecute();
  // Back online: what waited in the outbox goes out now.
  const onOnline = () => sync.syncNow();
  window.addEventListener("focus", onFocus);
  window.addEventListener("online", onOnline);
  return () => {
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("online", onOnline);
    throttler.cancel();
  };
};

const loading: AccountState = { kind: "loading" };
const noSync = () => () => {};
const loadingState = () => loading;
export const useAccountState = () => {
  const sync = typeof window === "undefined" ? null : webSync();
  return useSyncExternalStore(sync?.subscribe ?? noSync, sync?.state ?? loadingState, loadingState);
};
