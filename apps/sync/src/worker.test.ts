import { expect, test } from "vite-plus/test";

import worker from "./worker.ts";

const get = (path: string) => worker.fetch(new Request(`https://sync.test${path}`));

test("/health answers ok", async () => {
  const response = await get("/health");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
});

test("an unknown path is 404", async () => {
  expect((await get("/nope")).status).toBe(404);
});
