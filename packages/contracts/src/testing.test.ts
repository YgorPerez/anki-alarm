import { SYNC_PROTOCOL } from "@app/core";
import { DateTime, Effect } from "effect";
import { afterEach, describe, expect, test } from "vite-plus/test";

import type { Change } from "./index.ts";
import { fakeSyncApi, memorySyncServer, type FakeSyncApi } from "./testing.ts";

let api: FakeSyncApi | undefined;
afterEach(async () => {
  await api?.dispose();
  api = undefined;
});

const hlc = (wallMs: number, deviceId = "phone") => ({ wallMs, counter: 0, deviceId });
const deck = (name: string, at: number, deviceId?: string): Change => ({
  kind: "decks",
  record: {
    id: "deck",
    fields: {
      name: { value: name, hlc: hlc(at, deviceId) },
      presetId: { value: "p", hlc: hlc(1) },
    },
  },
});

describe("fakeSyncApi", () => {
  test("answers through the contract, so the client gets decoded values", async () => {
    const serverTime = DateTime.makeUnsafe("2026-10-28T12:00:00.000Z");
    api = await fakeSyncApi({
      metadata: (userId) => Effect.succeed({ syncProtocol: 1, serverTime, userId }),
    });

    const metadata = await api.run(api.client.metadata.metadata());

    expect(metadata.syncProtocol).toBe(1);
    expect(metadata.userId).toBe("user-1");
    expect(DateTime.formatIso(metadata.serverTime)).toBe("2026-10-28T12:00:00.000Z");
    expect(api.calls.metadata).toBe(1);
  });

  test("fails a response the contract's schema can't encode", async () => {
    const serverTime = DateTime.makeUnsafe("2026-10-28T12:00:00.000Z");
    api = await fakeSyncApi({
      metadata: (userId) => Effect.succeed({ syncProtocol: 1.5, serverTime, userId }),
    });

    await expect(api.run(api.client.metadata.metadata())).rejects.toMatchObject({
      _tag: "HttpApiSchemaError",
    });
  });

  test("fails a call the scenario doesn't answer", async () => {
    api = await fakeSyncApi({});

    await expect(api.run(api.client.metadata.metadata())).rejects.toThrow(
      "The scenario doesn't answer metadata.metadata",
    );
    expect(api.calls.metadata).toBe(1);
  });

  test("answers Unauthorized without a session", async () => {
    api = await fakeSyncApi({ ...memorySyncServer(), user: null });

    await expect(
      api.run(api.client.changes.pull({ payload: { cursor: 0 } })),
    ).rejects.toMatchObject({ _tag: "Unauthorized" });
  });
});

describe("memorySyncServer", () => {
  test("merges pushes like the Worker and pulls the winners by cursor", async () => {
    const server = memorySyncServer({ pageSize: 1 });
    api = await fakeSyncApi(server);
    const push = (changes: Change[]) =>
      api!.run(api!.client.changes.push({ payload: { changes } }));

    expect(await push([deck("Words", 10)])).toEqual({ accepted: 1 });
    expect(await push([deck("Old", 5, "web")])).toEqual({ accepted: 0 });
    await push([
      {
        kind: "tombstone",
        tombstone: { id: "deck", kind: "decks", sequence: 0, hlc: hlc(6) },
      },
      deck("Newer", 99),
    ]);

    const first = await api.run(api.client.changes.pull({ payload: { cursor: 0 } }));
    expect(first).toEqual({
      changes: [
        {
          kind: "tombstone",
          tombstone: { id: "deck", kind: "decks", sequence: 2, hlc: hlc(6) },
        },
      ],
      cursor: 2,
      more: false,
    });
    expect(await api.run(api.client.changes.pull({ payload: { cursor: 2 } }))).toEqual({
      changes: [],
      cursor: 2,
      more: false,
    });
  });

  test("carries alarm journal events, which only append and never conflict", async () => {
    api = await fakeSyncApi(memorySyncServer());
    const event = {
      id: "event",
      kind: "dismissed",
      alarmId: "alarm",
      ringId: "ring",
      wallTime: 1000,
      elapsedRealtime: 50,
    };
    const push = (changes: Change[]) =>
      api!.run(api!.client.changes.push({ payload: { changes } }));

    expect(await push([{ kind: "alarmEvent", event }])).toEqual({ accepted: 1 });
    expect(
      await push([{ kind: "alarmEvent", event: { ...event, wallTime: 2000, ringId: null } }]),
    ).toEqual({ accepted: 0 });
    expect(await api.run(api.client.changes.pull({ payload: { cursor: 0 } }))).toEqual({
      changes: [{ kind: "alarmEvent", event }],
      cursor: 1,
      more: false,
    });
  });

  test("stores media once, and serves a file only to an account with a note that uses it", async () => {
    const server = memorySyncServer();
    const ana = await fakeSyncApi({ ...server, user: "ana" });
    const bia = await fakeSyncApi({ ...server, user: "bia" });
    api = ana;
    const bytes = new TextEncoder().encode("a picture");
    const sha256 = "92b2fa58028958317e408bd84ecfa70f5ee35b121991dbc232c49d166353708b";
    const media: Change = {
      kind: "media",
      record: {
        id: "m1",
        fields: {
          name: { value: "casa.jpg", hlc: hlc(1) },
          sha256: { value: sha256, hlc: hlc(1) },
          size: { value: bytes.length, hlc: hlc(1) },
        },
      },
    };
    const note: Change = {
      kind: "notes",
      record: {
        id: "n1",
        fields: { noteTypeId: { value: "basic", hlc: hlc(1) } },
        values: [{ value: '<img src="casa.jpg">', hlc: hlc(1) }],
      },
    };

    // A media record whose file never arrived isn't stored.
    expect(await ana.run(ana.client.changes.push({ payload: { changes: [media] } }))).toEqual({
      accepted: 0,
    });
    expect(
      await ana.run(ana.client.media.missing({ payload: { hashes: [sha256, "f".repeat(64)] } })),
    ).toEqual({ missing: [sha256, "f".repeat(64)] });
    await expect(
      ana.run(ana.client.media.upload({ params: { sha256: "f".repeat(64) }, payload: bytes })),
    ).rejects.toMatchObject({ _tag: "MediaRejected", reason: "hash" });
    await ana.run(ana.client.media.upload({ params: { sha256 }, payload: bytes }));
    expect(await ana.run(ana.client.media.missing({ payload: { hashes: [sha256] } }))).toEqual({
      missing: [],
    });

    await ana.run(ana.client.changes.push({ payload: { changes: [media] } }));
    await expect(ana.run(ana.client.media.download({ params: { sha256 } }))).rejects.toMatchObject({
      _tag: "MediaNotFound",
    });
    await ana.run(ana.client.changes.push({ payload: { changes: [note] } }));
    expect(await ana.run(ana.client.media.download({ params: { sha256 } }))).toEqual(bytes);
    await expect(bia.run(bia.client.media.download({ params: { sha256 } }))).rejects.toMatchObject({
      _tag: "MediaNotFound",
    });
    expect(server.files()).toEqual([sha256]);
    await bia.dispose();
  });

  test("answers UpdateRequired when its protocol isn't the app's", async () => {
    api = await fakeSyncApi(memorySyncServer({ syncProtocol: SYNC_PROTOCOL + 1 }));

    await expect(
      api.run(api.client.changes.pull({ payload: { cursor: 0 } })),
    ).rejects.toMatchObject({ _tag: "UpdateRequired", syncProtocol: SYNC_PROTOCOL + 1 });
  });
});
