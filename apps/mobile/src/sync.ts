// Signing in turns sync on (ADR 0001, 0007). The first account on this phone merges its local data;
// a different account than last time asks first; signing out keeps local data. While signed in,
// sync runs on open and resume, after local writes, after each alarm session and on refresh.
import {
  syncScheduler,
  type ClientData,
  type MediaSyncResult,
  type SyncResult,
  type SyncStatus,
} from "@app/client-data";
import type { SyncClient } from "@app/contracts";
import { signInPlan } from "@app/core";
import { Effect } from "effect";
import { useSyncExternalStore } from "react";

export interface AccountUser {
  id: string;
  email: string;
}
/** The signed-in Google account and its session. The phone's is in auth.ts. */
export interface Account {
  current: () => Promise<AccountUser | null>;
  /** Null when the user closes the account picker. */
  signIn: () => Promise<AccountUser | null>;
  signOut: () => Promise<void>;
  /** The contract's client, carrying the session. */
  client: () => Promise<SyncClient>;
}

export type AccountState =
  | { kind: "loading" }
  | { kind: "signedOut"; busy: boolean; failed: boolean }
  /** Signed in to another account than the one this phone synced: merge into it, or cancel. */
  | { kind: "confirm"; user: AccountUser }
  /** `media` is what the last sync did with media files, until the first one ends. */
  | { kind: "signedIn"; user: AccountUser; sync: SyncStatus; media: MediaSyncResult | null };

type Data = ClientData["Service"];
type UseData = <A, E>(use: (data: Data) => Effect.Effect<A, E>) => Promise<A>;

export function createSync({ account, data }: { account: Account; data: UseData }) {
  let state: AccountState = { kind: "loading" };
  const listeners = new Set<() => void>();
  const synced = new Set<(result: SyncResult) => void>();
  const set = (next: AccountState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const scheduler = syncScheduler({
    run: async () => {
      const client = await account.client();
      const result = await data((d) => d.sync(client));
      if (state.kind === "signedIn") set({ ...state, media: result.media });
      for (const listener of synced) listener(result);
    },
    onStatus: (sync) => {
      if (state.kind === "signedIn") set({ ...state, sync });
    },
  });
  let unsubscribe: (() => void) | undefined;
  void data((d) => Effect.sync(() => d)).then((d) => {
    unsubscribe = d.subscribe(() => {
      if (state.kind === "signedIn") scheduler.soon();
    });
  });
  const enter = (user: AccountUser) => {
    scheduler.resume();
    set({ kind: "signedIn", user, sync: scheduler.status(), media: null });
    scheduler.now();
  };
  /** Continues, merges or asks, as Core's `signInPlan` says. */
  const arrive = async (user: AccountUser) => {
    const plan = signInPlan(await data((d) => d.syncAccount), user.id);
    if (plan === "ask") return set({ kind: "confirm", user });
    if (plan === "merge") await data((d) => d.adoptAccount(user.id));
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
    /** Merge this phone's data into the account it just signed in to. */
    confirm: async () => {
      if (state.kind !== "confirm") return;
      const { user } = state;
      await data((d) => d.adoptAccount(user.id));
      enter(user);
    },
    /** Signing out keeps every local deck, review and alarm. */
    signOut: async () => {
      await account.signOut().catch(() => {});
      signedOut();
    },
    /** Open, resume, after an alarm session, pull-to-refresh. */
    syncNow: () => {
      if (state.kind === "signedIn") scheduler.now();
    },
    dispose: () => {
      unsubscribe?.();
      scheduler.dispose();
    },
  };
}
export type Sync = ReturnType<typeof createSync>;

const loading: AccountState = { kind: "loading" };
const noSync = () => () => {};
const loadingState = () => loading;
/** The account's state; loading for a build without sync. */
export const useAccountState = (sync: Sync | null) =>
  useSyncExternalStore(
    sync?.subscribe ?? noSync,
    sync?.state ?? loadingState,
    sync?.state ?? loadingState,
  );
