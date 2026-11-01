import type { AnkiDroidProvider } from "@app/client-data";
import type {
  AnkiDroidCard,
  AnkiDroidDeck,
  AnkiDroidSource,
  SyncBackAnswer,
  SyncBackSuspension,
  SyncBackBury,
} from "@app/core";
import { ankiDroidAccess } from "@app/core";
import { Effect } from "effect";
import { localData } from "./database.ts";

/** Why a provider call failed, as the AnkiDroid screens explain it. */
export class AnkiDroidError extends Error {
  readonly reason: "permission" | "unavailable" | "failed";
  constructor(reason: AnkiDroidError["reason"], cause?: unknown) {
    super(`AnkiDroid: ${reason}`, { cause });
    this.reason = reason;
  }
}

/**
 * What the AnkiDroid screens need from the phone: `modules/ankidroid` and the `.apkg` media
 * route. The Android implementation is in `ankidroid-android.ts`; tests use `memoryAnkiDroid`.
 */
export interface AnkiDroidApi {
  suspend: (action: SyncBackSuspension) => Effect.Effect<AnkiDroidCard | null, AnkiDroidError>;
  /** `null` when AnkiDroid isn't installed. Read on every visit and resume. */
  status: Effect.Effect<{ versionCode: number; permission: "granted" | "denied" } | null, Error>;
  requestPermission: Effect.Effect<"granted" | "prompted" | "settings", Error>;
  decks: Effect.Effect<AnkiDroidDeck[], AnkiDroidError>;
  readDeck: (deckId: number) => Effect.Effect<AnkiDroidSource, AnkiDroidError>;
  /** Every card of these AnkiDroid notes, with scheduling. */
  cards: (noteIds: readonly number[]) => Effect.Effect<AnkiDroidCard[], AnkiDroidError>;
  /** Answers a card in AnkiDroid and reads it back; `null` when AnkiDroid has no such card. */
  answer: (answer: SyncBackAnswer) => Effect.Effect<AnkiDroidCard | null, AnkiDroidError>;
  /** Buries a card in AnkiDroid and reads it back; `null` when AnkiDroid has no such card. */
  bury: (bury: SyncBackBury) => Effect.Effect<AnkiDroidCard | null, AnkiDroidError>;
  /** Opens AnkiDroid's `DO_SYNC` intent, which starts its sync with AnkiWeb. */
  requestSync: Effect.Effect<void, AnkiDroidError>;
  /** Lets the user pick an `.apkg` and stores its media. `null` when the picker is cancelled. */
  importMedia: Effect.Effect<number | null, Error>;
}

/** The provider client-data's sync back and pull call. */
export const ankiDroidProvider = (api: AnkiDroidApi): AnkiDroidProvider => ({
  readDeck: api.readDeck,
  cards: api.cards,
  answer: api.answer,
  suspend: api.suspend,
  bury: api.bury,
  requestSync: api.requestSync,
});

/** Automatic sync back, shared by study, backgrounding and alarm sessions. */
export const syncBackAfterSession = (api: AnkiDroidApi) =>
  Effect.gen(function* () {
    const on = yield* localData((data) => data.autoSyncBack);
    if (!on) return 0;
    const status = yield* localData((data) => data.ankiDroidSyncBackStatus);
    const owned = yield* localData((data) =>
      Effect.map(data.collection, (state) =>
        state.decks.some((d) => d.anki && d.fields.linkedBy?.value === data.deviceId),
      ),
    );
    if (!owned && !status.pending.length) return 0;
    const access = ankiDroidAccess(yield* api.status);
    if (access !== "ready") {
      yield* localData((data) => data.setAnkiDroidSyncBackFailure(access));
      return 0;
    }
    const summary = yield* localData((data) => data.syncBackAnkiDroid(ankiDroidProvider(api))).pipe(
      Effect.catch(() => Effect.succeed({ sent: 0 })),
    );
    return summary.sent;
  }).pipe(
    Effect.catch(() =>
      localData((data) => data.setAnkiDroidSyncBackFailure("failed")).pipe(Effect.as(0)),
    ),
  );

export function memoryAnkiDroid(options: {
  installed: { versionCode: number; permission: "granted" | "denied" } | null;
  decks?: AnkiDroidDeck[];
  sources?: AnkiDroidSource[];
  /** Media files the picked package holds; `null` cancels the picker. */
  media?: number | null;
  /** What the provider throws, e.g. after the permission is revoked. */
  failure?: AnkiDroidError["reason"];
}): AnkiDroidApi & {
  requests: number;
  syncRequests: number;
  answers: SyncBackAnswer[];
  buries: SyncBackBury[];
} {
  const state = { ...options, sources: structuredClone(options.sources ?? []) };
  const fail = (): Effect.Effect<void, AnkiDroidError> =>
    state.failure ? Effect.fail(new AnkiDroidError(state.failure)) : Effect.void;
  const allCards = () => state.sources.flatMap((s) => s.cards);
  const api = {
    requests: 0,
    syncRequests: 0,
    answers: [] as SyncBackAnswer[],
    buries: [] as SyncBackBury[],
    status: Effect.sync(() => state.installed),
    requestPermission: Effect.sync(() => {
      api.requests++;
      if (state.installed) state.installed = { ...state.installed, permission: "granted" };
      return "prompted" as const;
    }),
    decks: fail().pipe(Effect.map(() => state.decks ?? [])),
    readDeck: (deckId: number) =>
      fail().pipe(
        Effect.flatMap(() => {
          const source = state.sources.find((s) => s.deckId === deckId);
          return source
            ? Effect.succeed(structuredClone(source))
            : Effect.fail(new AnkiDroidError("failed"));
        }),
      ),
    cards: (noteIds: readonly number[]) =>
      fail().pipe(
        Effect.map(() => {
          const notes = new Set(noteIds);
          return structuredClone(allCards().filter((c) => notes.has(c.noteId)));
        }),
      ),
    // AnkiDroid's scheduler: each answer is one more review, at the time of the sync.
    answer: (answer: SyncBackAnswer) =>
      fail().pipe(
        Effect.map(() => {
          api.answers.push(answer);
          const card = allCards().find((c) => c.noteId === answer.noteId && c.ord === answer.ord);
          if (!card) return null;
          Object.assign(card, {
            reps: card.reps + 1,
            lastReviewSecs: Math.floor(Date.now() / 1000),
          });
          return { ...card };
        }),
      ),
    suspend: ({ noteId, ord }: SyncBackSuspension) =>
      fail().pipe(
        Effect.map(() => {
          const card = allCards().find((c) => c.noteId === noteId && c.ord === ord);
          if (!card) return null;
          card.queue = -1;
          return { ...card };
        }),
      ),
    // AnkiDroid's Bury: the card moves to the user-buried queue.
    bury: (bury: SyncBackBury) =>
      fail().pipe(
        Effect.map(() => {
          api.buries.push(bury);
          const card = allCards().find((c) => c.noteId === bury.noteId && c.ord === bury.ord);
          if (!card) return null;
          card.queue = -3;
          return { ...card };
        }),
      ),
    requestSync: fail().pipe(
      Effect.map(() => {
        api.syncRequests++;
      }),
    ),
    importMedia: Effect.sync(() => state.media ?? null),
  };
  return api;
}
