import { DateTime, Effect } from "effect";
import { afterEach, describe, expect, test } from "vite-plus/test";

import { fakeSyncApi, type FakeSyncApi } from "./testing.ts";

let api: FakeSyncApi | undefined;
afterEach(async () => {
  await api?.dispose();
  api = undefined;
});

describe("fakeSyncApi", () => {
  test("answers through the contract, so the client gets decoded values", async () => {
    const serverTime = DateTime.makeUnsafe("2026-10-28T12:00:00.000Z");
    api = await fakeSyncApi({ metadata: () => Effect.succeed({ syncProtocol: 1, serverTime }) });

    const metadata = await api.run(api.client.metadata.metadata());

    expect(metadata.syncProtocol).toBe(1);
    expect(DateTime.formatIso(metadata.serverTime)).toBe("2026-10-28T12:00:00.000Z");
    expect(api.calls.metadata).toBe(1);
  });

  test("fails a response the contract's schema can't encode", async () => {
    const serverTime = DateTime.makeUnsafe("2026-10-28T12:00:00.000Z");
    api = await fakeSyncApi({
      metadata: () => Effect.succeed({ syncProtocol: 1.5, serverTime }),
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
});
