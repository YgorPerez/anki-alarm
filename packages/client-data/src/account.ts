// Signing in turns sync on (ADR 0001, 0007), the same on the phone and the web. The first account
// on a device merges its local data; a different account than last time asks first; signing out
// keeps local data. While signed in, sync runs when the app says (open, resume, focus, after an
// alarm session, refresh) and a few seconds after local writes.
import { signInPlan } from "@app/core";
import { Data, Effect } from "effect";

import { syncScheduler, type SyncStatus } from "./scheduler.ts";
import type { MediaSyncResult, SyncResult } from "./sync.ts";

export interface AccountUser {
  id: string;
  email: string;
}
/** Google or the session server failed: the session check, the sign-in or the sign-out. */
export class AccountFailed extends Data.TaggedError("AccountFailed")<{
  message: string;
  cause?: unknown;
}> {}
/** The signed-in Google account: the phone's account picker, or the web's redirect. */
export interface Account {
  current: Effect.Effect<AccountUser | null, AccountFailed>;
  /** Null when the user closes the account picker. The web's redirect leaves the page instead. */
  signIn: Effect.Effect<AccountUser | null, AccountFailed>;
  signOut: Effect.Effect<void, AccountFailed>;
}
/** What the controller needs from the local database, wherever it runs. */
export interface AccountData {
  syncAccount: Effect.Effect<string | null, Error>;
  adoptAccount: (userId: string) => Effect.Effect<void, Error>;
  /**
   * One sync of the device's data, with the signed-in session. Its failure's tag tells the
   * scheduler what to do (`UpdateRequired`, `Unauthorized`, `AccountMismatch`).
   */
  sync: Effect.Effect<SyncResult, Error>;
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

/** The media problem a sync left, worst first, as a copy key: null when files all moved. */
export function mediaNotice(media: MediaSyncResult | null) {
  if (!media) return null;
  if (media.storageRefused) return { key: "mediaRefused", count: 0 } as const;
  if (media.heldBack > 0) return { key: "mediaHeld", count: media.heldBack } as const;
  if (media.missing > 0) return { key: "mediaMissing", count: media.missing } as const;
  return null;
}

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
  const syncOnce = Effect.map(data.sync, (result) => {
    if (state.kind === "signedIn") set({ ...state, media: result.media });
    for (const listener of synced) listener(result);
  });
  const scheduler = syncScheduler({
    // Pacer's debouncer calls back with a promise.
    run: () => Effect.runPromise(syncOnce),
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
  const arrive = (user: AccountUser) =>
    Effect.gen(function* () {
      const plan = signInPlan(yield* data.syncAccount, user.id);
      if (plan === "ask") set({ kind: "confirm", user });
      else {
        if (plan === "merge") yield* data.adoptAccount(user.id);
        enter(user);
      }
    });
  const signedOut = (failed = false) => set({ kind: "signedOut", busy: false, failed });
  /** Arrives with the user the account gave, or signs out; any failure is `fallback`. */
  const through = (
    user: Effect.Effect<AccountUser | null, AccountFailed>,
    fallback: Effect.Effect<void>,
  ) =>
    user.pipe(
      Effect.flatMap((found) => (found ? arrive(found) : Effect.sync(() => signedOut()))),
      Effect.catchCause(() => fallback),
    );
  /** On open: picks up the stored session, if any. */
  const start = through(
    account.current,
    Effect.sync(() => signedOut()),
  );
  const signIn = Effect.suspend(() => {
    set({ kind: "signedOut", busy: true, failed: false });
    return through(
      account.signIn,
      Effect.sync(() => signedOut(true)),
    );
  });
  /** Merge this device's data into the account it just signed in to. */
  const confirm = Effect.suspend(() => {
    if (state.kind !== "confirm") return Effect.void;
    const { user } = state;
    return Effect.map(data.adoptAccount(user.id), () => enter(user));
  });
  /** Signing out keeps every local deck, review and alarm. */
  const signOut = account.signOut.pipe(
    Effect.catchCause(() => Effect.void),
    Effect.andThen(Effect.sync(() => signedOut())),
  );

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
    // What the screens call: promises over the programs above.
    start: () => Effect.runPromise(start),
    signIn: () => Effect.runPromise(signIn),
    confirm: () => Effect.runPromise(confirm),
    signOut: () => Effect.runPromise(signOut),
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
