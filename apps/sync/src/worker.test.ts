import { SYNC_PROTOCOL } from "@app/core";
import { expect, test } from "vite-plus/test";

import worker from "./worker.ts";

const get = (path: string) => worker.fetch(new Request(`https://sync.test${path}`));

test("/health answers ok", async () => {
  const response = await get("/health");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, syncProtocol: SYNC_PROTOCOL });
});

test("an unknown path is 404", async () => {
  expect((await get("/nope")).status).toBe(404);
});

test("sync rejects an incompatible protocol without blocking offline use", async () => {
  expect((await get("/sync")).status).toBe(426);
  const response = await worker.fetch(
    new Request("https://sync.test/sync", {
      headers: { "X-Sync-Protocol": String(SYNC_PROTOCOL) },
    }),
  );
  expect(response.status).toBe(404); // Sync endpoints are implemented by #44.
});
