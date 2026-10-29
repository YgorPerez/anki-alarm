import { UpdateRequired, Unauthorized } from "@app/contracts";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { syncScheduler, type SyncStatus } from "./index.ts";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** A sync the test finishes by hand. */
function controlledSync() {
  const pending: { resolve: () => void; reject: (error: unknown) => void }[] = [];
  const run = vi.fn<() => Promise<void>>(
    () => new Promise<void>((resolve, reject) => void pending.push({ resolve, reject })),
  );
  return { run, pending };
}
const statuses = () => {
  const seen: SyncStatus[] = [];
  return { seen, onStatus: (status: SyncStatus) => void seen.push(status) };
};

test("local writes sync once, a few seconds after the last one", async () => {
  const { run, pending } = controlledSync();
  const scheduler = syncScheduler({ run, debounceMs: 3000, now: () => 42 });
  scheduler.soon();
  vi.advanceTimersByTime(2000);
  scheduler.soon();
  vi.advanceTimersByTime(2999);
  expect(run).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(run).toHaveBeenCalledTimes(1);
  pending[0]!.resolve();
  await vi.waitFor(() => expect(scheduler.status()).toEqual({ kind: "idle", lastSyncedAt: 42 }));
  scheduler.dispose();
});

test("a trigger during a sync runs exactly one more sync after it", async () => {
  const { run, pending } = controlledSync();
  const scheduler = syncScheduler({ run });
  scheduler.now();
  scheduler.now();
  scheduler.now();
  expect(run).toHaveBeenCalledTimes(1);
  pending[0]!.resolve();
  await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
  pending[1]!.resolve();
  await vi.waitFor(() => expect(scheduler.status().kind).toBe("idle"));
  expect(run).toHaveBeenCalledTimes(2);
  scheduler.dispose();
});

test("a protocol mismatch pauses sync until the app updates", async () => {
  const { run, pending } = controlledSync();
  const { seen, onStatus } = statuses();
  const scheduler = syncScheduler({ run, onStatus });
  scheduler.now();
  pending[0]!.reject(new UpdateRequired({ syncProtocol: 2 }));
  await vi.waitFor(() => expect(scheduler.status()).toEqual({ kind: "updateRequired" }));
  scheduler.now();
  scheduler.soon();
  vi.advanceTimersByTime(60_000);
  expect(run).toHaveBeenCalledTimes(1);
  expect(seen.map((s) => s.kind)).toEqual(["syncing", "updateRequired"]);
  scheduler.dispose();
});

test("an expired session stops sync until the user signs in again", async () => {
  const { run, pending } = controlledSync();
  const scheduler = syncScheduler({ run });
  scheduler.now();
  pending[0]!.reject(new Unauthorized());
  await vi.waitFor(() => expect(scheduler.status()).toEqual({ kind: "signedOut" }));
  scheduler.now();
  expect(run).toHaveBeenCalledTimes(1);
  scheduler.resume();
  scheduler.now();
  expect(run).toHaveBeenCalledTimes(2);
  scheduler.dispose();
});

test("a network failure is reported and the next trigger tries again", async () => {
  const { run, pending } = controlledSync();
  const scheduler = syncScheduler({ run });
  scheduler.now();
  pending[0]!.reject(new Error("offline"));
  await vi.waitFor(() => expect(scheduler.status()).toEqual({ kind: "failed" }));
  scheduler.now();
  expect(run).toHaveBeenCalledTimes(2);
  scheduler.dispose();
});
