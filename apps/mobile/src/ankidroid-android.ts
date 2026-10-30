import type { AnkiDroidCard, AnkiDroidDeck, AnkiDroidSource } from "@app/core";
import { Effect } from "effect";
import native from "../modules/ankidroid/index.ts";
import { pickAndImportApkgMedia } from "./apkg.ts";
import { AnkiDroidError, type AnkiDroidApi } from "./ankidroid.ts";

const reason = (error: unknown): AnkiDroidError["reason"] => {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  if (code === "ERR_ANKIDROID_PERMISSION") return "permission";
  if (code === "ERR_ANKIDROID_UNAVAILABLE") return "unavailable";
  return "failed";
};
const provider = <A>(read: () => Promise<string>) =>
  Effect.tryPromise({
    // The native module returns JSON in Core's AnkiDroid shapes.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    try: async () => JSON.parse(await read()) as A,
    catch: (error) => new AnkiDroidError(reason(error), error),
  });
const attempt = <A>(run: () => A) =>
  Effect.try({ try: run, catch: (error) => new Error(String(error)) });

export const androidAnkiDroid: AnkiDroidApi = {
  status: attempt(() => native.status()),
  requestPermission: attempt(() => native.requestPermission()),
  decks: provider<AnkiDroidDeck[]>(() => native.decks()),
  readDeck: (deckId) => provider<AnkiDroidSource>(() => native.readDeck(deckId)),
  cards: (noteIds) => provider<AnkiDroidCard[]>(() => native.cards([...noteIds])),
  answer: ({ noteId, ord, ease, timeTakenMs }) =>
    provider<AnkiDroidCard | null>(() => native.answer(noteId, ord, ease, timeTakenMs)),
  suspend: ({ noteId, ord }) => provider<AnkiDroidCard | null>(() => native.suspend(noteId, ord)),
  bury: ({ noteId, ord }) => provider<AnkiDroidCard | null>(() => native.bury(noteId, ord)),
  importMedia: Effect.tryPromise({
    try: pickAndImportApkgMedia,
    catch: (error) => new Error(String(error)),
  }),
};
