// The phone in the journeys: the real client-data service on Node's SQLite, signed in to the dev
// Worker with an unsigned ID token as Android's account picker would give one, syncing through the
// contract's client with its session cookie, as apps/mobile does.
import type { Collection } from "@app/core";
import { makeSyncClient } from "@app/contracts";
import { Effect } from "effect";

import { devIdToken } from "../src/dev-token.ts";
import { openDevice } from "../test/device.ts";
import { E2E } from "./servers.ts";

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

export async function phone(email: string) {
  const data = await openDevice("phone");
  const response = await fetch(`${E2E.sync}/api/auth/sign-in/social`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: E2E.web },
    body: JSON.stringify({ provider: "google", idToken: { token: devIdToken(email) } }),
  });
  if (!response.ok) throw new Error(`Phone sign-in failed: ${response.status}`);
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const client = await run(makeSyncClient({ baseUrl: E2E.sync, headers: () => ({ cookie }) }));
  const { userId } = await run(client.metadata.metadata());
  await run(data.adoptAccount(userId));
  return {
    /** Changes the collection, as the phone's editor does. */
    edit: (command: (collection: Collection) => void) => run(data.changeCollection(command)),
    sync: () => run(data.sync(client)),
    reviewLog: () => run(data.reviewLog),
    deckNames: async () => (await run(data.collection)).decks.map((d) => d.fields.name.value),
  };
}

/** A phone signed in to `email` that made a deck of `notes` and synced it. */
export async function phoneWithDeck(email: string, deck: string, notes: [string, string][]) {
  const device = await phone(email);
  await device.edit((c) => {
    const { id } = c.createDeck(deck);
    for (const [front, back] of notes) c.addBasicNote(id, front, back);
  });
  await device.sync();
  return device;
}
