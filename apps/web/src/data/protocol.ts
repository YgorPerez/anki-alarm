import type { CollectionState, Grade, LogEntry, Settings, ThemeChoice } from "@app/core";
import type { PendingChange, SyncResult } from "@app/client-data";

/**
 * What a tab can ask the leader's database for: each operation's arguments and result. Commands
 * cross tabs as data. Never send individual transaction statements across this boundary.
 */
export interface Operations {
  settings: [[], Settings];
  setTheme: [[patch: Partial<ThemeChoice>], Settings];
  collection: [[], CollectionState];
  reviewLog: [[], LogEntry[]];
  pendingChanges: [[], PendingChange[]];
  /** A review from the web, for a card in the deck's study queue now. */
  answerCard: [[cardId: string, grade: Grade, durationMs: number], LogEntry];
  undo: [[entryId: string], LogEntry];
  syncAccount: [[], string | null];
  adoptAccount: [[userId: string], void];
  /** One sync with the signed-in session, run by the leader for every tab. */
  sync: [[], SyncResult];
}
export type Kind = keyof Operations;
export type Args<K extends Kind> = Operations[K][0];
export type Output<K extends Kind> = Operations[K][1];
export type Operation = { [K in Kind]: { kind: K; args: Args<K> } }[Kind];

/** Writes refresh every tab, and the tab that wrote syncs soon. */
export const WRITES: ReadonlySet<Kind> = new Set([
  "setTheme",
  "answerCard",
  "undo",
  "adoptAccount",
]);

/** A failure as data. `tag` keeps an Effect error's `_tag` (Unauthorized, UpdateRequired…). */
export interface Failure {
  message: string;
  tag?: string;
}
export type Request = { type: "request"; id: string; leader: string; operation: Operation };
export type Response =
  | { type: "response"; id: string; ok: true; result: unknown }
  | { type: "response"; id: string; ok: false; error: Failure };
export type Message =
  | Request
  | Response
  | { type: "discover" }
  | { type: "leader"; id: string }
  | { type: "changed" };

export const toFailure = (error: unknown): Failure => {
  const tag =
    typeof error === "object" && error !== null && "_tag" in error ? error["_tag"] : undefined;
  const message = error instanceof Error ? error.message : String(error);
  return typeof tag === "string" ? { message, tag } : { message };
};
/** Back to an error the sync scheduler can read the tag of. */
export const fromFailure = (failure: Failure) => {
  const error = new Error(failure.message);
  if (failure.tag !== undefined) Object.defineProperty(error, "_tag", { value: failure.tag });
  return error;
};
