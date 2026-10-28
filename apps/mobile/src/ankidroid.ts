import type { AnkiDroidDeck, AnkiDroidSource } from "@app/core";
import { Effect } from "effect";

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
  /** `null` when AnkiDroid isn't installed. Read on every visit and resume. */
  status: Effect.Effect<{ versionCode: number; permission: "granted" | "denied" } | null, Error>;
  requestPermission: Effect.Effect<"granted" | "prompted" | "settings", Error>;
  decks: Effect.Effect<AnkiDroidDeck[], AnkiDroidError>;
  readDeck: (deckId: number) => Effect.Effect<AnkiDroidSource, AnkiDroidError>;
  /** Lets the user pick an `.apkg` and stores its media. `null` when the picker is cancelled. */
  importMedia: Effect.Effect<number | null, Error>;
}

export function memoryAnkiDroid(options: {
  installed: { versionCode: number; permission: "granted" | "denied" } | null;
  decks?: AnkiDroidDeck[];
  sources?: AnkiDroidSource[];
  /** Media files the picked package holds; `null` cancels the picker. */
  media?: number | null;
  /** What the provider throws, e.g. after the permission is revoked. */
  failure?: AnkiDroidError["reason"];
}): AnkiDroidApi & { requests: number } {
  const state = { ...options };
  const fail = (): Effect.Effect<void, AnkiDroidError> =>
    state.failure ? Effect.fail(new AnkiDroidError(state.failure)) : Effect.void;
  const api = {
    requests: 0,
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
          const source = state.sources?.find((s) => s.deckId === deckId);
          return source ? Effect.succeed(source) : Effect.fail(new AnkiDroidError("failed"));
        }),
      ),
    importMedia: Effect.sync(() => state.media ?? null),
  };
  return api;
}
