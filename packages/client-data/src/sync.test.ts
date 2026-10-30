/* oxlint-disable eslint/no-await-in-loop -- Devices sync one after another, in order. */
import { DatabaseSync } from "node:sqlite";
import { newAlarm, type AlarmEvent } from "@app/core";
import { fakeSyncApi, memorySyncServer, type FakeSyncApi } from "@app/contracts/testing";
import { Effect } from "effect";
import { afterEach, expect, test } from "vite-plus/test";
import ankiDroid from "../../core/fixtures/ankidroid-deck.json" with { type: "json" };
import {
  ClientData,
  clientDataLayer,
  MediaStorageRefused,
  memoryMediaFiles,
  type ExecuteSql,
} from "./index.ts";

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
  const files = memoryMediaFiles();
  const data = await Effect.runPromise(
    ClientData.pipe(
      Effect.provide(
        clientDataLayer(
          {
            connect,
            now: () => clock.now,
            ...(name === "web" ? { origin: "web" as const } : {}),
            random: () => new Uint8Array(16).fill(n++).map((b, i) => (i === 15 ? name.length : b)),
          },
          files,
        ),
      ),
    ),
  );
  return { data, run, clock, files };
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
  const deckId = phoneState.decks[0]!.id;
  await phone.run(
    phone.data.saveAlarm({ ...newAlarm("alarm-1"), label: "Trabalho", deckId, need: 5 }),
  );
  await phone.run(phone.data.setTheme({ primary: "#7fd4ff" }));
  await phone.run(phone.data.ingestEvents([journalEvent("e1", "ringStarted")]));
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
    expect(state.notes.map((n) => n.values.map((v) => v.value))).toEqual([["casa", "house"]]);
    expect(await side.run(side.data.reviewLog)).toMatchObject([{ cardId, grade: 3 }]);
    expect(await side.run(side.data.alarms)).toMatchObject([
      { id: "alarm-1", label: "Trabalho", deckId, need: 5 },
    ]);
    expect((await side.run(side.data.settings)).fields.primary.value).toBe("#7fd4ff");
    expect(await side.run(side.data.events)).toEqual([journalEvent("e1", "ringStarted")]);
    expect(await side.run(side.data.pendingChanges)).toEqual([]);
    expect(await side.run(side.data.syncAccount)).toBe("user-1");
  }
});

const journalEvent = (id: string, kind: string, wallTime = 2_000): AlarmEvent => ({
  id,
  kind,
  alarmId: "alarm-1",
  ringId: "ring-1",
  wallTime,
  elapsedRealtime: wallTime - 1_000,
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
  await phone.run(phone.data.changeCollection((c) => c.editNote(note.id, ["casa nova", "house"])));
  await web.run(web.data.changeCollection((c) => c.editNote(note.id, ["casa", "home"])));

  await sync(phone, web, phone);

  for (const side of [phone, web]) {
    const [merged] = (await side.run(side.data.collection)).notes;
    expect(merged?.values.map((v) => v.value)).toEqual(["casa nova", "home"]);
  }
});

test("a deck linked from AnkiDroid reaches the other device with its tags, Anki ids and owner", async () => {
  const { phone, web, sync } = await pair();
  phone.clock.now = 1_770_000_000_000;
  const deckId = await phone.run(phone.data.linkAnkiDroidDeck(ankiDroid.source));
  await sync(phone, web);
  const local = await phone.run(phone.data.collection);
  const synced = await web.run(web.data.collection);
  const linked = synced.decks.find((d) => d.id === deckId)!;
  expect(linked.fields.linkedBy?.value).toBe(
    local.decks.find((d) => d.id === deckId)!.fields.linkedBy?.value,
  );
  expect(linked.anki).toEqual(local.decks.find((d) => d.id === deckId)!.anki);
  const notes = (state: typeof local) =>
    state.notes
      .filter((n) => n.anki)
      .map((n) => ({ values: n.values, tags: n.fields.tags.value, anki: n.anki }));
  expect(notes(synced)).toEqual(notes(local));
  expect(notes(synced).length).toBeGreaterThan(0);
  expect(synced.cards.filter((c) => c.anki)).toEqual(local.cards.filter((c) => c.anki));
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

test("a deleted alarm stays deleted on every device, even against a later edit", async () => {
  const { phone, web, sync, api } = await pair();
  await phone.run(phone.data.saveAlarm({ ...newAlarm("alarm-1"), label: "Trabalho" }));
  await sync(phone, web);
  phone.clock.now = 2_000;
  web.clock.now = 9_000;
  await phone.run(phone.data.deleteAlarm("alarm-1"));
  expect(await phone.run(phone.data.alarms)).toEqual([]);
  await web.run(web.data.saveAlarm({ ...newAlarm("alarm-1"), label: "Academia" }));

  await sync(web, phone);
  const pulled = await web.run(web.data.sync(api.client));
  // A pulled delete re-arms the phone's alarms, as a pulled edit does.
  expect(pulled.changed).toContain("alarms");

  for (const side of [phone, web]) {
    expect(await side.run(side.data.alarms)).toEqual([]);
    expect(await side.run(side.data.pendingChanges)).toEqual([]);
  }
  // Deleting it again, or an alarm never saved, changes nothing.
  await phone.run(phone.data.deleteAlarm("alarm-1"));
  await phone.run(phone.data.deleteAlarm("never-saved"));
  await phone.run(phone.data.saveAlarm(newAlarm("alarm-1")));
  expect(await phone.run(phone.data.alarms)).toEqual([]);
  expect(await phone.run(phone.data.pendingChanges)).toEqual([]);
});

test("reviews from both devices append, and the outbox empties after a push", async () => {
  const { phone, web, sync, api } = await pair();
  const cardId = (await phone.run(phone.data.collection)).cards[0]!.id;
  await phone.run(phone.data.answerCard(cardId, 1, 800));
  web.clock.now = 5_000;
  await web.run(web.data.answerCard(cardId, 3, 900));
  await sync(phone, web, phone);

  for (const side of [phone, web]) {
    const reviews = (await side.run(side.data.reviewLog)).map(
      (e) => e.kind === "review" && [e.grade, e.origin],
    );
    expect(reviews).toHaveLength(2);
    // Each answer keeps the platform it was given on.
    expect(new Set(reviews.map(String))).toEqual(new Set(["1,phone", "3,web"]));
  }
  const pushes = api.calls.push.length;
  await sync(phone);
  expect(api.calls.push.length).toBe(pushes);
  expect(await phone.run(phone.data.pendingChanges)).toEqual([]);
});

test("the phone's alarm journal reaches the web once, and ingesting it again queues nothing", async () => {
  const { phone, web, sync } = await pair();
  const journal = [journalEvent("e1", "ringStarted"), journalEvent("e2", "dismissed", 9_000)];
  let writes = 0;
  phone.data.subscribe(() => (writes += 1));
  await phone.run(phone.data.ingestEvents(journal));
  expect(writes).toBe(1);
  expect(await phone.run(phone.data.pendingChanges)).toMatchObject([
    { database: "anki-alarm.db", kind: "alarmEvent", recordId: "e1" },
    { database: "anki-alarm.db", kind: "alarmEvent", recordId: "e2" },
  ]);
  await sync(phone, web);
  expect(await web.run(web.data.events)).toEqual(journal);

  // Native drains again after a missed ack: the copies change nothing and queue nothing.
  await phone.run(phone.data.ingestEvents([{ ...journal[0]!, kind: "missed" }]));
  expect(writes).toBe(1);
  expect(await phone.run(phone.data.pendingChanges)).toEqual([]);
  await sync(phone, web);
  expect(await web.run(web.data.events)).toEqual(journal);
  expect(await phone.run(phone.data.events)).toEqual(journal);
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

const bytes = (text: string) => new TextEncoder().encode(text);
const file = (name: string, text: string) => ({ name, bytes: async () => bytes(text) });
/** The phone stores a picture and a sound and adds a note that uses each. */
async function withMedia(phone: Awaited<ReturnType<typeof device>>, deckId: string) {
  await phone.run(
    phone.data.storeMedia([file("casa.jpg", "a picture"), file("casa.mp3", "a sound")]),
  );
  return phone.run(
    phone.data.changeCollection((c) => {
      c.addBasicNote(deckId, '<img src="casa.jpg">', "house");
      c.addBasicNote(deckId, "[sound:casa.mp3]", "sound");
    }),
  );
}

test("media uploads before the notes that use it, and the other device downloads every file", async () => {
  const { server, api, phone, web, sync, deck } = await pair();
  await withMedia(phone, deck.id);

  const result = await phone.run(phone.data.sync(api.client));
  expect(result.media).toMatchObject({ uploaded: 2, heldBack: 0 });
  expect(server.files()).toHaveLength(2);
  // Both files were in R2 before the push that carried their records and notes.
  expect(api.calls.uploads).toHaveLength(2);

  const pulled = await web.run(web.data.sync(api.client));
  expect(pulled.media).toMatchObject({ downloaded: 2, missing: 0, storageRefused: false });
  expect(pulled.changed).toContain("media");
  expect(web.files.files.get("casa.jpg")).toEqual(bytes("a picture"));
  expect(web.files.files.get("casa.mp3")).toEqual(bytes("a sound"));

  // Nothing new: no upload, no download.
  await sync(phone, web);
  expect(api.calls.uploads).toHaveLength(2);
  expect(api.calls.downloads).toHaveLength(2);
});

test("a file the server already has, from anyone, isn't uploaded again", async () => {
  const { server, api, phone, web, deck } = await pair();
  await web.run(web.data.storeMedia([file("other-name.jpg", "a picture")]));
  await web.run(web.data.sync(api.client));
  expect(api.calls.uploads).toHaveLength(1);
  await withMedia(phone, deck.id);
  await phone.run(phone.data.sync(api.client));
  expect(api.calls.uploads).toHaveLength(2);
  expect(server.files()).toHaveLength(2);
});

test("a failed upload holds back only the records that use that file, until it succeeds", async () => {
  const server = memorySyncServer();
  let failing = true;
  const flaky = await fakeSyncApi({
    ...server,
    upload: (sha256, content, user) =>
      failing && new TextDecoder().decode(content) === "a picture"
        ? Effect.die(new Error("network"))
        : server.upload(sha256, content, user),
  });
  apis.push(flaky);
  const phone = await device("phone");
  const web = await device("web");
  const deckId = (await phone.run(phone.data.changeCollection((c) => void c.createDeck("Words"))))
    .decks[0]!.id;
  for (const side of [phone, web]) await side.run(side.data.adoptAccount("user-1"));
  await phone.run(phone.data.sync(flaky.client));
  const state = await withMedia(phone, deckId);
  await phone.run(phone.data.changeCollection((c) => void c.createDeck("Plain")));

  const result = await phone.run(phone.data.sync(flaky.client));
  expect(result.media).toMatchObject({ uploaded: 1, heldBack: 3 });
  const stored = server.stored("user-1");
  const pictureNote = state.notes.find((n) => n.values[0]?.value.includes("casa.jpg"))!;
  expect(stored.some((c) => c.kind === "notes" && c.record.id === pictureNote.id)).toBe(false);
  expect(stored.some((c) => c.kind === "decks" && c.record.fields["name"]?.value === "Plain")).toBe(
    true,
  );
  expect(
    stored.filter((c) => c.kind === "notes").map((c) => c.kind === "notes" && c.record.id),
  ).toHaveLength(1);
  const pending = await phone.run(phone.data.pendingChanges);
  expect(new Set(pending.map((p) => p.kind))).toEqual(new Set(["cards", "media", "notes"]));

  failing = false;
  expect((await phone.run(phone.data.sync(flaky.client))).media).toMatchObject({
    uploaded: 1,
    heldBack: 0,
  });
  expect(await phone.run(phone.data.pendingChanges)).toEqual([]);
  await web.run(web.data.sync(flaky.client));
  expect(web.files.files.get("casa.jpg")).toEqual(bytes("a picture"));
});

test("the first sync into an account uploads media stored before it, and holds back on failure", async () => {
  const server = memorySyncServer();
  const failing = await fakeSyncApi({
    ...server,
    upload: () => Effect.die(new Error("offline")),
  });
  apis.push(failing);
  const phone = await device("phone");
  const deckId = (await phone.run(phone.data.changeCollection((c) => void c.createDeck("Words"))))
    .decks[0]!.id;
  await withMedia(phone, deckId);
  await phone.run(phone.data.adoptAccount("user-1"));

  expect((await phone.run(phone.data.sync(failing.client))).media.heldBack).toBe(6);
  expect(server.stored("user-1").some((c) => c.kind === "notes")).toBe(false);
  expect(server.stored("user-1").some((c) => c.kind === "decks")).toBe(true);

  const api = await connect(server);
  expect((await phone.run(phone.data.sync(api.client))).media).toMatchObject({
    uploaded: 2,
    heldBack: 0,
  });
  expect(server.stored("user-1").filter((c) => c.kind === "notes")).toHaveLength(2);
});

test("a file replaced on one device reaches the other", async () => {
  const { api, phone, web, deck } = await pair();
  await withMedia(phone, deck.id);
  await phone.run(phone.data.sync(api.client));
  await web.run(web.data.sync(api.client));
  phone.clock.now = 5_000;
  await phone.run(phone.data.storeMedia([file("casa.jpg", "a better picture")]));
  await phone.run(phone.data.sync(api.client));
  expect((await web.run(web.data.sync(api.client))).media.downloaded).toBe(1);
  expect(web.files.files.get("casa.jpg")).toEqual(bytes("a better picture"));
});

test("when storage is refused the sync says so and the files stay missing", async () => {
  const { api, phone, web, deck } = await pair();
  await withMedia(phone, deck.id);
  await phone.run(phone.data.sync(api.client));
  web.files.refuse = true;

  const result = await web.run(web.data.sync(api.client));
  expect(result.media).toMatchObject({ downloaded: 0, missing: 2, storageRefused: true });
  expect(await web.run(web.data.missingMedia)).toEqual(["casa.jpg", "casa.mp3"]);

  web.files.refuse = false;
  await web.run(web.data.sync(api.client));
  expect(await web.run(web.data.missingMedia)).toEqual([]);
});

test("storing media writes the file and records its hash; the same bytes again queue nothing", async () => {
  const phone = await device("phone");
  expect(await phone.run(phone.data.storeMedia([file("casa.jpg", "a picture")]))).toBe(1);
  expect(phone.files.files.get("casa.jpg")).toEqual(bytes("a picture"));
  const before = (await phone.run(phone.data.pendingChanges)).length;
  await phone.run(phone.data.storeMedia([file("casa.jpg", "a picture")]));
  expect(await phone.run(phone.data.pendingChanges)).toHaveLength(before);
  await expect(phone.run(phone.data.storeMedia([file("../x", "no")]))).rejects.toThrow(
    "Unsafe media file name",
  );
  phone.files.refuse = true;
  await expect(phone.run(phone.data.storeMedia([file("b.jpg", "refused")]))).rejects.toBeInstanceOf(
    MediaStorageRefused,
  );
});

test("an alarm restored by a normal save survives an already pushed delete", async () => {
  const { phone, web, sync } = await pair();
  const alarm = { ...newAlarm("deleted"), label: "Work", deckId: "deck", need: 8 };
  await phone.run(phone.data.saveAlarm(alarm));
  await sync(phone, web);
  await phone.run(phone.data.deleteAlarm(alarm.id));
  await sync(phone, web);
  expect(await web.run(web.data.alarms)).toEqual([]);
  // Tombstones are permanent. Undo saves the captured settings with a fresh identity.
  await phone.run(phone.data.saveAlarm({ ...alarm, id: "restored" }));
  await sync(phone, web);
  expect(await phone.run(phone.data.alarms)).toEqual([{ ...alarm, id: "restored" }]);
  expect(await web.run(web.data.alarms)).toEqual([{ ...alarm, id: "restored" }]);
});
