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

  test("answers UpdateRequired when its protocol isn't the app's", async () => {
    api = await fakeSyncApi(memorySyncServer({ syncProtocol: SYNC_PROTOCOL + 1 }));

    await expect(
      api.run(api.client.changes.pull({ payload: { cursor: 0 } })),
    ).rejects.toMatchObject({ _tag: "UpdateRequired", syncProtocol: SYNC_PROTOCOL + 1 });
  });
});
