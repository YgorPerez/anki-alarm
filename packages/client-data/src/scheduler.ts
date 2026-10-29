// When a signed-in client syncs (ADR 0001): `now()` on open, resume, focus, after an alarm session
// and on pull-to-refresh; `soon()` after local writes, debounced with Pacer. One sync runs at a
// time, and a trigger during one runs one more after it.
import { Debouncer } from "@tanstack/pacer";

export type SyncStatus =
  | { kind: "idle"; lastSyncedAt: number | null }
  | { kind: "syncing" }
  /** The last sync failed (usually offline). The next trigger tries again. */
  | { kind: "failed" }
  /** The Worker's `SYNC_PROTOCOL` isn't the app's: no sync until the app updates. */
  | { kind: "updateRequired" }
  /** The session expired or belongs to another account: no sync until `resume()`. */
  | { kind: "signedOut" };

const tagOf = (error: unknown) =>
  typeof error === "object" && error !== null && "_tag" in error ? error["_tag"] : undefined;

export function syncScheduler(options: {
  run: () => Promise<unknown>;
  debounceMs?: number;
  now?: () => number;
  onStatus?: (status: SyncStatus) => void;
}) {
  let status: SyncStatus = { kind: "idle", lastSyncedAt: null };
  let running = false;
  let again = false;
  const set = (next: SyncStatus) => {
    status = next;
    options.onStatus?.(next);
  };
  const stopped = () => status.kind === "updateRequired" || status.kind === "signedOut";
  const start = () => {
    if (stopped()) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    set({ kind: "syncing" });
    options.run().then(
      () => finish({ kind: "idle", lastSyncedAt: (options.now ?? Date.now)() }),
      (error: unknown) => {
        const tag = tagOf(error);
        finish(
          tag === "UpdateRequired"
            ? { kind: "updateRequired" }
            : tag === "Unauthorized" || tag === "AccountMismatch"
              ? { kind: "signedOut" }
              : { kind: "failed" },
        );
      },
    );
  };
  const finish = (next: SyncStatus) => {
    running = false;
    set(next);
    if (again) {
      again = false;
      start();
    }
  };
  const debouncer = new Debouncer(start, { wait: options.debounceMs ?? 3000 });
  return {
    status: () => status,
    /** Syncs now, or right after the sync in progress. */
    now: () => {
      debouncer.cancel();
      start();
    },
    /** Syncs once local writes have settled. */
    soon: () => {
      if (!stopped()) debouncer.maybeExecute();
    },
    /** After signing in again: lets a stopped scheduler sync. */
    resume: () => {
      if (status.kind === "signedOut") set({ kind: "idle", lastSyncedAt: null });
    },
    dispose: () => debouncer.cancel(),
  };
}
export type SyncScheduler = ReturnType<typeof syncScheduler>;
