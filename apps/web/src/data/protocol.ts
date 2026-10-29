import type {
  Alarm,
  AlarmEvent,
  CollectionCommand,
  CollectionState,
  Grade,
  LogEntry,
  Settings,
  ThemeChoice,
} from "@app/core";
import type { ImportSummary, PendingChange, SyncResult } from "@app/client-data";

import type { ApkgExport } from "./apkg.ts";

/**
 * What a tab can ask the leader's database for: each operation's arguments and result. Commands
 * cross tabs as data. Never send individual transaction statements across this boundary.
 */
export interface Operations {
  settings: [[], Settings];
  setTheme: [[patch: Partial<ThemeChoice>], Settings];
  collection: [[], CollectionState];
  reviewLog: [[], LogEntry[]];
  /** The account's alarms, synced from the phone, to name them in wake-up stats. */
  alarms: [[], Alarm[]];
  /** The phones' alarm journals, synced append-only. */
  events: [[], AlarmEvent[]];
  pendingChanges: [[], PendingChange[]];
  /** A review from the web, for a card in the deck's study queue now. */
  answerCard: [[cardId: string, grade: Grade, durationMs: number], LogEntry];
  undo: [[entryId: string], LogEntry];
  /** An editing command; resolves with the id of the deck or note it created. */
  change: [[command: CollectionCommand], string | undefined];
  forgetCard: [[cardId: string], LogEntry];
  setDueDate: [[cardId: string, days: number], LogEntry];
  /** An `.apkg`'s bytes: media go to OPFS before the records. */
  importApkg: [[bytes: Uint8Array], ImportSummary];
  /** Reads only. */
  exportApkg: [[deckId: string], ApkgExport];
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
  "change",
  "forgetCard",
  "setDueDate",
  "importApkg",
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
/**
 * The leader's operation failed. `_tag` is the original error's (`UpdateRequired`, `Unauthorized`…),
 * so the sync scheduler reads it as it would on the phone; `LeaderFailed` when it had none.
 */
export class LeaderFailed extends Error {
  readonly ["_tag"]: string;
  constructor(failure: Failure) {
    super(failure.message);
    this["_tag"] = failure.tag ?? "LeaderFailed";
  }
}
/** Back to an error the sync scheduler can read the tag of. */
export const fromFailure = (failure: Failure) => new LeaderFailed(failure);
