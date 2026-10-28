import type { SyncClient } from "@app/contracts";

import { operations } from "../src/data/operations.ts";
import { WRITES, type Args, type Kind, type Operation, type Output } from "../src/data/protocol.ts";
import { openDevice } from "./device.ts";

// Replace only the browser transport/OPFS boundary. Reads and writes still use the real data
// service, migrations, Core rules and the leader's operations, against a fresh SQLite database for
// each test file.
const service = openDevice("web");

let syncClient: () => Promise<SyncClient> = () =>
  Promise.reject(new Error("This test has no sync server"));
/** The sync API the leader talks to: a fake one from `@app/contracts/testing`. */
export const setSyncClient = (client: () => Promise<SyncClient>) => {
  syncClient = client;
};
const execute = service.then((data) => operations(data, () => syncClient()));
const listeners = new Set<() => void>();
const writeListeners = new Set<() => void>();
const subscription = (set: Set<() => void>) => (listener: () => void) => {
  set.add(listener);
  return () => {
    set.delete(listener);
  };
};

export const testWebData = {
  async request<K extends Kind>(kind: K, ...args: Args<K>): Promise<Output<K>> {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const { result, changed } = await (await execute)({ kind, args } as Operation);
    if (changed) for (const listener of listeners) listener();
    if (WRITES.has(kind)) for (const listener of writeListeners) listener();
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return result as Output<K>;
  },
  subscribe: subscription(listeners),
  onLocalWrite: subscription(writeListeners),
  close: () => {},
};
