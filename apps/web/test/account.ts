import type { Account, AccountUser } from "@app/client-data";
import { Effect } from "effect";
import { fakeSyncApi, type FakeSyncApi, type MemorySyncServer } from "@app/contracts/testing";

import { setSyncClient } from "./local-data.ts";

/**
 * Google, as the screens see it: who is signed in, and who the next sign-in picks. Replaces
 * src/auth.ts in every screen test (setup.ts).
 */
export const google = { user: null as AccountUser | null, picks: [] as AccountUser[] };
export const fakeAccount: Account = {
  current: Effect.sync(() => google.user),
  signIn: Effect.sync(() => (google.user = google.picks.shift() ?? null)),
  signOut: Effect.sync(() => {
    google.user = null;
  }),
};

const apis: FakeSyncApi[] = [];
/** The leader syncs with `server` as whoever is signed in to Google now. */
export const syncWith = (server: MemorySyncServer) =>
  setSyncClient(async () => {
    const api = await fakeSyncApi({ ...server, user: google.user?.id ?? null });
    apis.push(api);
    return api.client;
  });
export const disposeApis = () => Promise.all(apis.splice(0).map((api) => api.dispose()));
