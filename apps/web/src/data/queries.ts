import { studyQueue } from "@app/core";
import { queryOptions } from "@tanstack/react-query";

import { webData } from "./client.ts";

/** The collection and its review log, read when the query runs, with the time it ran. */
const snapshot = async () => {
  const [collection, log] = await Promise.all([
    webData().request("collection"),
    webData().request("reviewLog"),
  ]);
  return { collection, log, now: Date.now() };
};

/** Every deck by name, with how many cards it has to study now. */
export const decksQuery = queryOptions({
  queryKey: ["decks"],
  queryFn: async () => {
    const { collection, log, now } = await snapshot();
    return (
      collection.decks
        .map((deck) => ({
          id: deck.id,
          name: deck.fields.name.value,
          due: studyQueue(collection, log, deck.id, now).length,
        }))
        // oxlint-disable-next-line unicorn/no-array-sort -- ES2022 target; sorts a fresh array.
        .sort((a, b) => a.name.localeCompare(b.name))
    );
  },
});

/** The whole collection and log, for the editor: decks, notes, note types and card states. */
export const collectionQuery = queryOptions({
  queryKey: ["collection"],
  queryFn: snapshot,
});

/** What the stats page computes from: the collection, the log, the alarms and their journal. */
export const statsQuery = queryOptions({
  queryKey: ["stats"],
  queryFn: async () => {
    const [{ collection, log, now }, alarms, events] = await Promise.all([
      snapshot(),
      webData().request("alarms"),
      webData().request("events"),
    ]);
    return { collection, log, alarms, events, now };
  },
});

/** A study session's data; `started` times the answer to the card on screen. */
export const studyQuery = (deckId: string) =>
  queryOptions({
    queryKey: ["study", deckId],
    queryFn: async () => ({ ...(await snapshot()), started: performance.now() }),
  });
