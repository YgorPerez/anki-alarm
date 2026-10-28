// Signing in turns sync on (ADR 0001, 0007), the same on the phone and the web. The first account
// on a device merges its local data; a different account than last time asks first; signing out
// keeps local data. While signed in, sync runs when the app says (open, resume, focus, after an
// alarm session, refresh) and a few seconds after local writes.
import { signInPlan } from "@app/core";

import { syncScheduler, type SyncStatus } from "./scheduler.ts";
import type { MediaSyncResult, SyncResult } from "./sync.ts";

export interface AccountUser {
  id: string;
  email: string;
}
/** The signed-in Google account: the phone's account picker, or the web's redirect. */
export interface Account {
  current: () => Promise<AccountUser | null>;
  /** Null when the user closes the account picker. The web's redirect leaves the page instead. */
  signIn: () => Promise<AccountUser | null>;
  signOut: () => Promise<void>;
}
/** What the controller needs from the local database, wherever it runs. */
export interface AccountData {
  syncAccount: () => Promise<string | null>;
  adoptAccount: (userId: string) => Promise<void>;
  /** One sync of the device's data, with the signed-in session. */
  sync: () => Promise<SyncResult>;
  /** Calls `listener` after each local write commits. Returns unsubscribe. */
  subscribe: (listener: () => void) => () => void;
}

export type AccountState =
  | { kind: "loading" }
  | { kind: "signedOut"; busy: boolean; failed: boolean }
  /** Signed in to another account than the one this device synced: merge into it, or cancel. */
  | { kind: "confirm"; user: AccountUser }
  /** `media` is what the last sync did with media files, until the first one ends. */
  | { kind: "signedIn"; user: AccountUser; sync: SyncStatus; media: MediaSyncResult | null };

export function accountSync({
  account,
  data,
  debounceMs,
}: {
  account: Account;
  data: AccountData;
  /** How long local writes settle before a sync (default 3 s). */
  debounceMs?: number;
}) {
  let state: AccountState = { kind: "loading" };
  const listeners = new Set<() => void>();
  const synced = new Set<(result: SyncResult) => void>();
  const set = (next: AccountState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const scheduler = syncScheduler({
    run: async () => {
      const result = await data.sync();
      if (state.kind === "signedIn") set({ ...state, media: result.media });
      for (const listener of synced) listener(result);
    },
    ...(debounceMs === undefined ? {} : { debounceMs }),
    onStatus: (sync) => {
      if (state.kind === "signedIn") set({ ...state, sync });
    },
  });
  const unsubscribe = data.subscribe(() => {
    if (state.kind === "signedIn") scheduler.soon();
  });
  const enter = (user: AccountUser) => {
    scheduler.resume();
    set({ kind: "signedIn", user, sync: scheduler.status(), media: null });
    scheduler.now();
  };
  /** Continues, merges or asks, as Core's `signInPlan` says. */
  const arrive = async (user: AccountUser) => {
    const plan = signInPlan(await data.syncAccount(), user.id);
    if (plan === "ask") return set({ kind: "confirm", user });
    if (plan === "merge") await data.adoptAccount(user.id);
    enter(user);
  };
  const signedOut = (failed = false) => set({ kind: "signedOut", busy: false, failed });

  return {
    state: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Called after each sync, to refresh what it changed. */
    onSynced: (listener: (result: SyncResult) => void) => {
      synced.add(listener);
      return () => {
        synced.delete(listener);
      };
    },
    /** On open: picks up the stored session, if any. */
    start: async () => {
      try {
        const user = await account.current();
        if (user) await arrive(user);
        else signedOut();
      } catch {
        signedOut();
      }
    },
    signIn: async () => {
      set({ kind: "signedOut", busy: true, failed: false });
      try {
        const user = await account.signIn();
        if (user) await arrive(user);
        else signedOut();
      } catch {
        signedOut(true);
      }
    },
    /** Merge this device's data into the account it just signed in to. */
    confirm: async () => {
      if (state.kind !== "confirm") return;
      const { user } = state;
      await data.adoptAccount(user.id);
      enter(user);
    },
    /** Signing out keeps every local deck, review and alarm. */
    signOut: async () => {
      await account.signOut().catch(() => {});
      signedOut();
    },
    /** Open, resume, focus, after an alarm session, refresh. */
    syncNow: () => {
      if (state.kind === "signedIn") scheduler.now();
    },
    dispose: () => {
      unsubscribe();
      scheduler.dispose();
    },
  };
}
export type AccountSync = ReturnType<typeof accountSync>;
