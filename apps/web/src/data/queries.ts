import { studyQueue } from "@app/core";
import { queryOptions } from "@tanstack/react-query";
import { Effect } from "effect";

import { webData } from "./client.ts";

/** The collection and its review log, read when the query runs, with the time it ran. */
const snapshot = Effect.suspend(() =>
  Effect.all([webData().request("collection"), webData().request("reviewLog")], {
    concurrency: "unbounded",
  }),
).pipe(Effect.map(([collection, log]) => ({ collection, log, now: Date.now() })));
/** Each query's function: its program, as the promise TanStack Query takes. */
const run =
  <A, E>(program: Effect.Effect<A, E>) =>
  () =>
    Effect.runPromise(program);

/** Every deck by name, with how many cards it has to study now. */
export const decksQuery = queryOptions({
  queryKey: ["decks"],
  queryFn: run(
    Effect.map(snapshot, ({ collection, log, now }) =>
      collection.decks
        .map((deck) => ({
          id: deck.id,
          name: deck.fields.name.value,
          due: studyQueue(collection, log, deck.id, now).length,
        }))
        // oxlint-disable-next-line unicorn/no-array-sort -- ES2022 target; sorts a fresh array.
        .sort((a, b) => a.name.localeCompare(b.name)),
    ),
  ),
});

/** The whole collection and log, for the editor: decks, notes, note types and card states. */
export const collectionQuery = queryOptions({
  queryKey: ["collection"],
  queryFn: run(snapshot),
});

/** What the stats page computes from: the collection, the log, the alarms and their journal. */
export const statsQuery = queryOptions({
  queryKey: ["stats"],
  queryFn: run(
    Effect.suspend(() =>
      Effect.all([snapshot, webData().request("alarms"), webData().request("events")], {
        concurrency: "unbounded",
      }),
    ).pipe(
      Effect.map(([{ collection, log, now }, alarms, events]) => ({
        collection,
        log,
        alarms,
        events,
        now,
      })),
    ),
  ),
});

/** A study session's data; `started` times the answer to the card on screen. */
export const studyQuery = (deckId: string) =>
  queryOptions({
    queryKey: ["study", deckId],
    queryFn: run(Effect.map(snapshot, (data) => ({ ...data, started: performance.now() }))),
  });
