import { DatabaseSync } from "node:sqlite";
import { fakeSyncApi, memorySyncServer, type FakeSyncApi } from "@app/contracts/testing";
import { Effect } from "effect";
import { afterEach, expect, test, vi } from "vite-plus/test";

import {
  accountSync,
  ClientData,
  clientDataLayer,
  type Account,
  type AccountSync,
  type AccountUser,
  type ExecuteSql,
} from "./index.ts";

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

async function device() {
  const databases = new Map<string, DatabaseSync>();
  const connect = (file: string): ExecuteSql => {
    let db = databases.get(file);
    if (!db) databases.set(file, (db = new DatabaseSync(":memory:")));
    const connection = db;
    return async (query, params, method) => {
      const statement = connection.prepare(query);
      if (method === "run") {
        statement.run(...params);
        return { rows: [] };
      }
      statement.setReturnArrays(true);
      return { rows: statement.all(...params) };
    };
  };
  let n = 0;
  return run(
    ClientData.pipe(
      Effect.provide(
        clientDataLayer({ connect, now: Date.now, random: () => new Uint8Array(16).fill(n++) }),
      ),
    ),
  );
}

let apis: FakeSyncApi[] = [];
let syncs: AccountSync[] = [];
afterEach(async () => {
  for (const sync of syncs) sync.dispose();
  await Promise.all(apis.map((api) => api.dispose()));
  apis = [];
  syncs = [];
});

const ana: AccountUser = { id: "ana", email: "ana@example.com" };

/** A device signed in to `user` against one server, through the controller. */
async function signedIn(server: ReturnType<typeof memorySyncServer>, user: AccountUser) {
  const data = await device();
  const account: Account = {
    current: async () => user,
    signIn: async () => user,
    signOut: async () => {},
  };
  const sync = accountSync({
    account,
    debounceMs: 10,
    data: {
      syncAccount: () => run(data.syncAccount),
      adoptAccount: (id) => run(data.adoptAccount(id)),
      sync: async () => {
        const api = await fakeSyncApi({ ...server, user: user.id });
        apis.push(api);
        return run(data.sync(api.client));
      },
      subscribe: data.subscribe,
    },
  });
  syncs.push(sync);
  await sync.start();
  await vi.waitFor(() => {
    const state = sync.state();
    expect(state.kind === "signedIn" && state.sync.kind).toBe("idle");
  });
  return { data, sync };
}

test("a stored session merges the device's first account and syncs it", async () => {
  const server = memorySyncServer();
  const { data, sync } = await signedIn(server, ana);

  expect(sync.state()).toMatchObject({ kind: "signedIn", user: ana });
  // The panel's media line reads what the last sync did with files.
  await vi.waitFor(() =>
    expect(sync.state()).toMatchObject({ media: { storageRefused: false, missing: 0 } }),
  );
  expect(await run(data.syncAccount)).toBe("ana");
  expect(server.stored("ana").some((change) => change.kind === "settings")).toBe(true);
});

test("a local write while signed in reaches the server without another trigger", async () => {
  const server = memorySyncServer();
  const { data } = await signedIn(server, ana);

  await run(data.changeCollection((c) => void c.createDeck("Palavras")));

  await vi.waitFor(() =>
    expect(
      server
        .stored("ana")
        .some((c) => c.kind === "decks" && c.record.fields["name"]?.value === "Palavras"),
    ).toBe(true),
  );
});
