/// <reference types="node" />
// The Worker against a local D1 (wrangler's platform proxy, Miniflare), called through the
// contract's derived client. Google's signature check is the only part replaced: the test signs in
// with unsigned ID tokens that the overridden verifier accepts.
import { readFile } from "node:fs/promises";
import { SYNC_PROTOCOL } from "@app/core";
import { makeSyncClient, type Change, type SyncClient } from "@app/contracts";
import { Effect } from "effect";
import { getPlatformProxy } from "wrangler";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";

import { makeWorker, type Env } from "./worker.ts";

const worker = makeWorker({ verifyIdToken: async () => true });
let env: Env;
let dispose: () => Promise<void>;

beforeAll(async () => {
  const proxy = await getPlatformProxy<Env>({
    configPath: new URL("../wrangler.toml", import.meta.url).pathname,
    persist: false,
  });
  dispose = proxy.dispose;
  env = {
    ...proxy.env,
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123",
    GOOGLE_CLIENT_ID: "web-client.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "unused",
  };
  const migration = await readFile(
    new URL("../migrations/0001_init.sql", import.meta.url).pathname,
    "utf8",
  );
  const statements = migration
    .replaceAll(/^--.*$/gm, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  await env.DB.batch(statements.map((statement) => env.DB.prepare(statement)));
}, 60_000);
afterAll(() => dispose());

const call = (path: string, init?: RequestInit) =>
  worker.fetch(new Request(`http://localhost:8787${path}`, init), env);

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
/** Signs in with an ID token for `sub`, as the phone does, and returns the session cookie. */
async function signIn(sub: string) {
  const claims = {
    iss: "https://accounts.google.com",
    aud: env.GOOGLE_CLIENT_ID,
    sub,
    email: `${sub}@example.com`,
    email_verified: true,
    name: sub,
    exp: Math.floor(Date.now() / 1000) + 600,
  };
  const token = `${base64url({ alg: "none" })}.${base64url(claims)}.`;
  const response = await call("/api/auth/sign-in/social", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify({ provider: "google", idToken: { token } }),
  });
  expect(response.status).toBe(200);
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  expect(cookie).toContain("session_token");
  return cookie;
}

const client = (cookie?: string): Promise<SyncClient> =>
  Effect.runPromise(
    makeSyncClient({
      baseUrl: "http://localhost:8787",
      headers: () => (cookie ? { cookie } : {}),
      fetch: (input, init) =>
        worker.fetch(new Request(input instanceof URL ? input.href : input, init), env),
    }),
  );
const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

const hlc = (wallMs: number, deviceId = "phone") => ({ wallMs, counter: 0, deviceId });
const note = (id: string, front: [string, number], back: [string, number]): Change => ({
  kind: "notes",
  record: {
    id,
    fields: {
      front: { value: front[0], hlc: hlc(front[1]) },
      back: { value: back[0], hlc: hlc(back[1], "web") },
    },
  },
});

test("/health answers ok", async () => {
  const response = await call("/health");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, syncProtocol: SYNC_PROTOCOL });
});

test("an unknown path is 404", async () => {
  expect((await call("/nope")).status).toBe(404);
});

test("a sync request without the app's protocol gets 426, decoded as UpdateRequired", async () => {
  const response = await call("/sync/metadata");
  expect(response.status).toBe(426);
  expect(await response.json()).toEqual({ _tag: "UpdateRequired", syncProtocol: SYNC_PROTOCOL });
});

test("the sync API requires a better-auth session", async () => {
  const api = await client();
  await expect(run(api.metadata.metadata())).rejects.toMatchObject({ _tag: "Unauthorized" });
  await expect(run(api.changes.pull({ payload: { cursor: 0 } }))).rejects.toMatchObject({
    _tag: "Unauthorized",
  });
});

test("signing in with a Google ID token opens a session the sync API accepts", async () => {
  const api = await client(await signIn("ana"));
  const metadata = await run(api.metadata.metadata());
  expect(metadata.syncProtocol).toBe(SYNC_PROTOCOL);
  const again = await run((await client(await signIn("ana"))).metadata.metadata());
  expect(again.userId).toBe(metadata.userId);
});

test("push merges field by field and pull returns the winners by cursor, per account", async () => {
  const api = await client(await signIn("bia"));
  const other = await client(await signIn("caio"));

  expect(
    await run(api.changes.push({ payload: { changes: [note("n1", ["casa", 10], ["house", 1])] } })),
  ).toEqual({ accepted: 1 });
  const { cursor } = await run(api.changes.pull({ payload: { cursor: 0 } }));
  await run(
    api.changes.push({
      payload: {
        changes: [note("n1", ["velha", 5], ["home", 20]), note("n2", ["a", 1], ["b", 1])],
      },
    }),
  );

  const page = await run(api.changes.pull({ payload: { cursor } }));
  expect(page.more).toBe(false);
  expect(page.changes).toEqual([
    note("n1", ["casa", 10], ["home", 20]),
    note("n2", ["a", 1], ["b", 1]),
  ]);
  expect(await run(other.changes.pull({ payload: { cursor: 0 } }))).toEqual({
    changes: [],
    cursor: 0,
    more: false,
  });
});

test("deletes beat later edits and reviews only append", async () => {
  const api = await client(await signIn("dora"));
  const review: Change = {
    kind: "reviewLog",
    entry: {
      kind: "review",
      id: "r1",
      cardId: "c1",
      at: 5,
      grade: 3,
      durationMs: 800,
      origin: "phone",
    },
  };
  await run(
    api.changes.push({
      payload: {
        changes: [
          { kind: "tombstone", tombstone: { id: "n1", kind: "notes", sequence: 0, hlc: hlc(3) } },
          review,
        ],
      },
    }),
  );
  expect(
    await run(
      api.changes.push({ payload: { changes: [note("n1", ["back", 99], ["x", 99]), review] } }),
    ),
  ).toEqual({ accepted: 0 });

  const { changes } = await run(api.changes.pull({ payload: { cursor: 0 } }));
  expect(changes).toEqual([
    { kind: "tombstone", tombstone: { id: "n1", kind: "notes", sequence: 1, hlc: hlc(3) } },
    review,
  ]);
});

test("concurrent pushes for one account both keep their field", async () => {
  const api = await client(await signIn("eva"));
  await run(api.changes.push({ payload: { changes: [note("n1", ["a", 1], ["b", 1])] } }));

  await Promise.all([
    run(api.changes.push({ payload: { changes: [note("n1", ["front", 50], ["b", 1])] } })),
    run(api.changes.push({ payload: { changes: [note("n1", ["a", 1], ["back", 60])] } })),
  ]);

  const { changes } = await run(api.changes.pull({ payload: { cursor: 0 } }));
  expect(changes).toEqual([note("n1", ["front", 50], ["back", 60])]);
});
