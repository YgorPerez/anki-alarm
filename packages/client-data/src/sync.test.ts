/* oxlint-disable eslint/no-await-in-loop -- Devices sync one after another, in order. */
import { DatabaseSync } from "node:sqlite";
import { newAlarm } from "@app/core";
import { fakeSyncApi, memorySyncServer, type FakeSyncApi } from "@app/contracts/testing";
import { Effect } from "effect";
import { afterEach, expect, test } from "vite-plus/test";
import { ClientData, clientDataLayer, type ExecuteSql } from "./index.ts";

/** One device: its own two SQLite databases and clock. */
async function device(name: string, clock = { now: 1_000 }) {
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
  const data = await Effect.runPromise(
    ClientData.pipe(
      Effect.provide(
        clientDataLayer({
          connect,
          now: () => clock.now,
          random: () => new Uint8Array(16).fill(n++).map((b, i) => (i === 15 ? name.length : b)),
        }),
      ),
    ),
  );
  return { data, run, clock };
}
const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

let apis: FakeSyncApi[] = [];
afterEach(async () => {
  await Promise.all(apis.map((api) => api.dispose()));
  apis = [];
});
const connect = async (server: ReturnType<typeof memorySyncServer>, user = "user-1") => {
  const api = await fakeSyncApi({ ...server, user });
  apis.push(api);
  return api;
};

test("the first sign-in on each device merges local data, and both end with everything", async () => {
  const server = memorySyncServer();
  const phone = await device("phone");
  const web = await device("web");
  const api = await connect(server);

  const phoneState = await phone.run(
    phone.data.changeCollection((c) => {
      const deck = c.createDeck("Português");
      c.addBasicNote(deck.id, "casa", "house");
    }),
  );
  const cardId = phoneState.cards[0]!.id;
  await phone.run(phone.data.answerCard(cardId, 3, 1200));
  await phone.run(phone.data.saveAlarm({ ...newAlarm("alarm-1"), label: "Trabalho" }));
  await phone.run(phone.data.setTheme({ primary: "#7fd4ff" }));
  await web.run(web.data.changeCollection((c) => void c.createDeck("Inglês")));

  for (const side of [phone, web, phone]) {
    await side.run(side.data.adoptAccount("user-1"));
    await side.run(side.data.sync(api.client));
  }
  await web.run(web.data.sync(api.client));

  for (const side of [phone, web]) {
    const state = await side.run(side.data.collection);
    expect(new Set(state.decks.map((d) => d.fields.name.value))).toEqual(
      new Set(["Inglês", "Português"]),
    );
    expect(state.notes.map((n) => n.fields.front.value)).toEqual(["casa"]);
    expect(await side.run(side.data.reviewLog)).toMatchObject([{ cardId, grade: 3 }]);
    expect(await side.run(side.data.alarms)).toMatchObject([{ id: "alarm-1", label: "Trabalho" }]);
    expect((await side.run(side.data.settings)).fields.primary.value).toBe("#7fd4ff");
    expect(await side.run(side.data.pendingChanges)).toEqual([]);
    expect(await side.run(side.data.syncAccount)).toBe("user-1");
  }
});

/** Two devices signed in to one account, synced once with a shared deck and note. */
async function pair(options: { pageSize?: number } = {}) {
  const server = memorySyncServer(options);
  const api = await connect(server);
  const phone = await device("phone");
  const web = await device("web");
  const state = await phone.run(
    phone.data.changeCollection((c) => {
      const deck = c.createDeck("Words");
      c.addBasicNote(deck.id, "casa", "house");
    }),
  );
  for (const side of [phone, web]) {
    await side.run(side.data.adoptAccount("user-1"));
    await side.run(side.data.sync(api.client));
  }
  const sync = async (...sides: (typeof phone)[]) => {
    for (const side of sides) await side.run(side.data.sync(api.client));
  };
  return { server, api, phone, web, sync, deck: state.decks[0]!, note: state.notes[0]! };
}

test("two devices editing different fields of a note both keep their edit", async () => {
  const { phone, web, sync, note } = await pair();
  phone.clock.now = 2_000;
  web.clock.now = 3_000;
  await phone.run(
    phone.data.changeCollection((c) => c.editBasicNote(note.id, "casa nova", "house")),
  );
  await web.run(web.data.changeCollection((c) => c.editBasicNote(note.id, "casa", "home")));

  await sync(phone, web, phone);

  for (const side of [phone, web]) {
    const [merged] = (await side.run(side.data.collection)).notes;
    expect([merged?.fields.front.value, merged?.fields.back.value]).toEqual(["casa nova", "home"]);
  }
});

test("a delete beats a later rename on the other device, and the deck stays deleted", async () => {
  const { phone, web, sync, deck } = await pair();
  phone.clock.now = 2_000;
  web.clock.now = 9_000;
  await phone.run(phone.data.changeCollection((c) => c.deleteDeck(deck.id)));
  await web.run(web.data.changeCollection((c) => c.renameDeck(deck.id, "Renamed")));

  await sync(web, phone, web);

  for (const side of [phone, web]) {
    const state = await side.run(side.data.collection);
    expect(state.decks).toEqual([]);
    expect(state.notes).toEqual([]);
    expect(new Set(state.tombstones.map((t) => t.kind))).toEqual(
      new Set(["cards", "decks", "notes"]),
    );
  }
});

test("reviews from both devices append, and the outbox empties after a push", async () => {
  const { phone, web, sync, api } = await pair();
  const cardId = (await phone.run(phone.data.collection)).cards[0]!.id;
  await phone.run(phone.data.answerCard(cardId, 1, 800));
  web.clock.now = 5_000;
  await web.run(web.data.answerCard(cardId, 3, 900));
  await sync(phone, web, phone);

  for (const side of [phone, web]) {
    const grades = (await side.run(side.data.reviewLog)).map((e) => e.kind === "review" && e.grade);
    expect(grades).toHaveLength(2);
    expect(new Set(grades)).toEqual(new Set([1, 3]));
  }
  const pushes = api.calls.push.length;
  await sync(phone);
  expect(api.calls.push.length).toBe(pushes);
  expect(await phone.run(phone.data.pendingChanges)).toEqual([]);
});

test("a local edit made after a pull wins over what was pulled, even with a slow clock", async () => {
  const { phone, web, sync, deck } = await pair();
  web.clock.now = 50_000;
  await web.run(web.data.changeCollection((c) => c.renameDeck(deck.id, "From web")));
  await sync(web, phone);
  phone.clock.now = 10; // A wrong phone clock, far behind.
  await phone.run(phone.data.changeCollection((c) => c.renameDeck(deck.id, "From phone")));
  await sync(phone, web);

  for (const side of [phone, web])
    expect((await side.run(side.data.collection)).decks[0]?.fields.name.value).toBe("From phone");
});

test("pulls page by page until the server has nothing more", async () => {
  const { web, api } = await pair({ pageSize: 2 });
  const state = await web.run(web.data.collection);
  expect(state.notes).toHaveLength(1);
  expect(state.cards).toHaveLength(1);
  expect(api.calls.pull.length).toBeGreaterThan(2);
});

test("a protocol mismatch pauses sync: nothing is pushed and local changes wait", async () => {
  const api = await connect(memorySyncServer({ syncProtocol: 999 }));
  const phone = await device("phone");
  await phone.run(phone.data.changeCollection((c) => void c.createDeck("Words")));
  await phone.run(phone.data.adoptAccount("user-1"));

  await expect(phone.run(phone.data.sync(api.client))).rejects.toMatchObject({
    _tag: "UpdateRequired",
    syncProtocol: 999,
  });
  expect(api.calls.push).toEqual([]);
  expect((await phone.run(phone.data.pendingChanges)).length).toBeGreaterThan(0);
});

test("a session for another account than the adopted one syncs nothing", async () => {
  const server = memorySyncServer();
  const phone = await device("phone");
  await phone.run(phone.data.adoptAccount("ana"));
  const api = await connect(server, "bia");

  await expect(phone.run(phone.data.sync(api.client))).rejects.toMatchObject({
    _tag: "AccountMismatch",
  });
  expect(api.calls.push).toEqual([]);
  expect(server.stored("bia")).toEqual([]);
});

test("adopting a different account merges this device's data into it", async () => {
  const server = memorySyncServer();
  const phone = await device("phone");
  await phone.run(phone.data.changeCollection((c) => void c.createDeck("Words")));
  await phone.run(phone.data.adoptAccount("ana"));
  await phone.run(phone.data.sync((await connect(server, "ana")).client));

  await phone.run(phone.data.adoptAccount("bia"));
  await phone.run(phone.data.sync((await connect(server, "bia")).client));

  expect(server.stored("bia").some((c) => c.kind === "decks")).toBe(true);
  expect(await phone.run(phone.data.syncAccount)).toBe("bia");
});

test("local writes notify subscribers after they commit", async () => {
  const phone = await device("phone");
  let calls = 0;
  const unsubscribe = phone.data.subscribe(() => (calls += 1));
  await phone.run(phone.data.changeCollection((c) => void c.createDeck("Words")));
  await phone.run(phone.data.setTheme({ primary: "#7fd4ff" }));
  unsubscribe();
  await phone.run(phone.data.setTheme({ primary: "#8be3a0" }));
  expect(calls).toBe(2);
});
