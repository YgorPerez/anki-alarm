// The leader's side of the protocol: each operation against the one ClientData service. The
// database Worker runs it over OPFS; screen tests run it over Node's SQLite.
import type { ClientData } from "@app/client-data";
import type { SyncClient } from "@app/contracts";
import { runCommand } from "@app/core";
import { Effect } from "effect";

import { apkgOperations, type ApkgFiles } from "./apkg.ts";
import { WRITES, type Args, type Kind, type Operation, type Output } from "./protocol.ts";

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

/**
 * One sync at a time across every tab. A request during a sync waits for one more after it, which
 * all requests made meanwhile share, so a write made during a sync still goes out.
 */
function coalesced<A>(task: () => Promise<A>) {
  let current: Promise<A> | undefined;
  let next: Promise<A> | undefined;
  const start = (): Promise<A> => {
    const running = task().finally(() => {
      if (current === running) current = undefined;
    });
    current = running;
    return running;
  };
  return () => {
    if (!current) return start();
    next ??= current
      .catch(() => {})
      .then(() => {
        next = undefined;
        return start();
      });
    return next;
  };
}

export function operations(
  data: ClientData["Service"],
  client: () => Promise<SyncClient>,
  files: ApkgFiles,
) {
  const sync = coalesced(async () => run(data.sync(await client())));
  const apkg = apkgOperations(data, files);
  const handlers: { [K in Exclude<Kind, "sync">]: (...args: Args<K>) => Promise<Output<K>> } = {
    settings: () => run(data.settings),
    setTheme: (patch) => run(data.setTheme(patch)),
    collection: () => run(data.collection),
    reviewLog: () => run(data.reviewLog),
    pendingChanges: () => run(data.pendingChanges),
    answerCard: (cardId, grade, durationMs) => run(data.answerCard(cardId, grade, durationMs)),
    undo: (entryId) => run(data.undo(entryId)),
    change: async (command) => {
      let id: string | undefined;
      await run(
        data.changeCollection((collection) => {
          id = runCommand(collection, command);
        }),
      );
      return id;
    },
    forgetCard: (cardId) => run(data.forgetCard(cardId)),
    setDueDate: (cardId, days) => run(data.setDueDate(cardId, days)),
    importApkg: apkg.importApkg,
    exportApkg: apkg.exportApkg,
    syncAccount: () => run(data.syncAccount),
    adoptAccount: (userId) => run(data.adoptAccount(userId)),
  };
  /** Runs one operation. `changed`: it committed something every tab should show. */
  return async (operation: Operation): Promise<{ result: unknown; changed: boolean }> => {
    if (operation.kind === "sync") {
      const result = await sync();
      return { result, changed: result.changed.length > 0 };
    }
    // Each handler takes its own operation's arguments.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const handler = handlers[operation.kind] as (...args: unknown[]) => Promise<unknown>;
    return { result: await handler(...operation.args), changed: WRITES.has(operation.kind) };
  };
}
