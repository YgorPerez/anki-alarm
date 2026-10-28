/// <reference types="node" />
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vite-plus/test";
import { Effect } from "effect";
import { ClientData, clientDataLayer, type ExecuteSql } from "./index.ts";
import type { Collection } from "@app/core";
const openCollectionStore = async (
  execute: ExecuteSql,
  env: { now: () => number; random: () => Uint8Array },
) => {
  const service = await Effect.runPromise(
    ClientData.pipe(Effect.provide(clientDataLayer({ ...env, connect: () => execute }))),
  );
  return {
    read: () => Effect.runPromise(service.collection),
    change: (command: (collection: Collection) => void) =>
      Effect.runPromise(service.changeCollection(command)),
    pending: () => Effect.runPromise(service.pendingChanges),
  };
};

test("SQLite reload retains decks, edited notes, cards and permanent tombstones", async () => {
  const directory = mkdtempSync(join(tmpdir(), "anki-alarm-38-"));
  const filename = join(directory, "collection.db");
  let sqlite = new DatabaseSync(filename);
  let failInsert = false;
  let n = 0;
  const env = { now: () => 1700000000000, random: () => new Uint8Array(16).fill(n++) };
  const execute: Parameters<typeof openCollectionStore>[0] = (query, params, method) => {
    if (failInsert && query.startsWith('INSERT INTO "notes"'))
      return Promise.reject(new Error("disk full"));
    const statement = sqlite.prepare(query);
    if (method === "run") {
      statement.run(...params);
      return Promise.resolve({ rows: [] });
    }
    statement.setReturnArrays(true);
    return Promise.resolve({ rows: statement.all(...params) });
  };
  try {
    const store = await openCollectionStore(execute, env);
    const state = await store.change((c) => {
      const deck = c.createDeck("Words");
      const note = c.addBasicNote(deck.id, "casa", "house");
      c.editBasicNote(note.id, "casa", "home");
    });
    sqlite.close();
    sqlite = new DatabaseSync(filename);
    const reopened = await openCollectionStore(execute, env);
    expect(await reopened.read()).toEqual(state);
    expect((await reopened.read()).notes[0]!.values[1]!.value).toBe("home");
    await reopened.change((c) => c.deleteDeck(state.decks[0]!.id));
    const deleted = await reopened.read();
    expect(deleted.cards).toEqual([]);
    expect(deleted.tombstones).toHaveLength(3);
    const fresh = await reopened.change((c) => {
      c.createDeck("Other");
    });
    expect(fresh.decks[0]!.fields.name.hlc.deviceId).toBe(state.decks[0]!.fields.name.hlc.deviceId);
    expect(fresh.tombstones).toEqual(deleted.tombstones);
    await expect(
      reopened.change((c) => {
        c.createDeck("Discard");
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect(await reopened.read()).toEqual(fresh);
    const pending = await reopened.pending();
    failInsert = true;
    await expect(
      reopened.change((c) => {
        c.addBasicNote(fresh.decks[0]!.id, "front", "back");
      }),
    ).rejects.toThrow("Failed query");
    failInsert = false;
    expect(await reopened.read()).toEqual(fresh);
    expect(await reopened.pending()).toEqual(pending);
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
