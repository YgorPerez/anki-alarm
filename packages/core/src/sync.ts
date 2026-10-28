// The sync merge of ADR 0001. The Worker resolves every push with these functions and the clients
// apply every pull with them, so both sides agree on the winner.
import type { Field, Hlc, RecordKind, Tombstone } from "./collection.ts";
import type { LogEntry } from "./study.ts";

/** The record kinds that merge field by field. */
export type SyncKind = RecordKind | "settings" | "alarms";
export interface FieldRecord {
  id: string;
  fields: { [key: string]: Field<unknown> };
}
/** One record, delete or review log entry, as it travels in a push or a pull. */
export type SyncChange =
  | { kind: SyncKind; record: FieldRecord }
  | { kind: "tombstone"; tombstone: Tombstone }
  | { kind: "reviewLog"; entry: LogEntry };

export const SYNC_KINDS: readonly SyncKind[] = [
  "decks",
  "presets",
  "noteTypes",
  "notes",
  "cards",
  "settings",
  "alarms",
];

/**
 * What signing in does with local data (ADR 0001): the device's first account merges it, the
 * account it last synced just syncs, and a different account asks before merging.
 */
export function signInPlan(lastAccount: string | null, account: string) {
  if (lastAccount === null) return "merge";
  return lastAccount === account ? "continue" : "ask";
}

/** Newer wall time wins, then the higher counter, then the device id breaks the tie. */
export function compareHlc(a: Hlc, b: Hlc): number {
  return (
    a.wallMs - b.wallMs ||
    a.counter - b.counter ||
    (a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0)
  );
}

/** Field-level last-write-wins. The result keeps `current`'s id. */
export function mergeRecord<R extends FieldRecord>(current: R | undefined, incoming: R): R {
  if (!current) return incoming;
  const fields: FieldRecord["fields"] = { ...current.fields };
  for (const [key, field] of Object.entries(incoming.fields)) {
    const mine = fields[key];
    if (!mine || compareHlc(field.hlc, mine.hlc) > 0) fields[key] = field;
  }
  // Every key of both records of the same kind is kept with its own field type.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return { ...current, fields } as R;
}

/**
 * The slot a change lands in. A tombstone shares its record's slot, so a delete meets the edits it
 * beats. Settings are one record per account, whatever id each device gave it.
 */
export function syncSlot(change: SyncChange): { kind: string; id: string } {
  if (change.kind === "tombstone") return { kind: change.tombstone.kind, id: change.tombstone.id };
  if (change.kind === "reviewLog") return { kind: "reviewLog", id: change.entry.id };
  if (change.kind === "settings") return { kind: "settings", id: "settings" };
  return { kind: change.kind, id: change.record.id };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * What a slot holds after `incoming` arrives, or undefined when it keeps `stored`. Deletes beat
 * every edit and are final; review log entries only append.
 */
export function resolveChange(
  stored: SyncChange | undefined,
  incoming: SyncChange,
): SyncChange | undefined {
  if (!stored) return incoming;
  if (stored.kind === "tombstone" || stored.kind === "reviewLog") return undefined;
  if (incoming.kind === "tombstone") return incoming;
  if (incoming.kind === "reviewLog") return undefined;
  const record = mergeRecord(stored.record, incoming.record);
  return same(record, stored.record) ? undefined : { kind: stored.kind, record };
}
