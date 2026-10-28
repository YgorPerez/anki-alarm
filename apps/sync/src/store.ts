// Push and pull over D1 (ADR 0001). A push reads the slots it touches, resolves every change with
// Core's merge, and writes the winners with the account's next sequence numbers in one batch. The
// batch only applies if the account's sequence is still the one it read, so two pushes for one
// account never interleave: the loser re-reads and merges again.
import { resolveChange, syncSlot, type SyncChange } from "@app/core";
import type { Change, PullResult } from "@app/contracts";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { syncAccounts, syncRecords } from "./schema.ts";

/** The contract checks a change's envelope; Core's types describe its records. */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const toCore = (change: Change) => change as SyncChange;
// Bodies are changes this store wrote.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const parse = (body: string) => JSON.parse(body) as SyncChange;
const key = (slot: { kind: string; id: string }) => `${slot.kind}:${slot.id}`;
/** Keeps each bound JSON parameter well under D1's 2 MB value limit. */
const MAX_JSON = 900_000;
const ATTEMPTS = 5;

export function syncStore(d1: D1Database) {
  const db = drizzle(d1);
  const ensureAccount = (userId: string) =>
    db.insert(syncAccounts).values({ userId }).onConflictDoNothing();

  async function pushOnce(userId: string, changes: readonly Change[]) {
    const [account] = await db
      .select({ sequence: syncAccounts.sequence })
      .from(syncAccounts)
      .where(eq(syncAccounts.userId, userId));
    const base = account?.sequence ?? 0;
    const ids = [...new Set(changes.map((change) => syncSlot(toCore(change)).id))];
    const rows = await db
      .select({ kind: syncRecords.kind, id: syncRecords.id, body: syncRecords.body })
      .from(syncRecords)
      .where(
        and(
          eq(syncRecords.userId, userId),
          sql`${syncRecords.id} IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`,
        ),
      );
    const slots = new Map(rows.map((row) => [key(row), parse(row.body)]));
    const winners = new Map<string, { kind: string; id: string; change: SyncChange }>();
    for (const change of changes) {
      const slot = syncSlot(toCore(change));
      const winner = resolveChange(slots.get(key(slot)), toCore(change));
      if (!winner) continue;
      slots.set(key(slot), winner);
      winners.delete(key(slot)); // Keep sequence order: the slot moves to the end.
      winners.set(key(slot), { ...slot, change: winner });
    }
    if (winners.size === 0) return { accepted: 0, applied: true };
    const pushId = crypto.randomUUID();
    const chunks: { kind: string; id: string; sequence: number; body: string }[][] = [[]];
    let size = 0;
    let sequence = base;
    for (const { kind, id, change } of winners.values()) {
      sequence += 1;
      const body = JSON.stringify(change);
      if (size + body.length > MAX_JSON && chunks.at(-1)!.length > 0) {
        chunks.push([]);
        size = 0;
      }
      chunks.at(-1)!.push({ kind, id, sequence, body });
      size += body.length;
    }
    // Raw D1: drizzle's batch can't carry these guarded statements.
    const [moved] = await d1.batch([
      d1
        .prepare(
          "UPDATE sync_accounts SET sequence = ?1, push_id = ?2 WHERE user_id = ?3 AND sequence = ?4",
        )
        .bind(sequence, pushId, userId, base),
      ...chunks.map((chunk) =>
        d1
          .prepare(
            `INSERT INTO sync_records (user_id, kind, id, sequence, body)
            SELECT ?1, json_extract(value, '$.kind'), json_extract(value, '$.id'),
              json_extract(value, '$.sequence'), json_extract(value, '$.body')
            FROM json_each(?2)
            WHERE EXISTS (SELECT 1 FROM sync_accounts WHERE user_id = ?1 AND push_id = ?3)
            ON CONFLICT (user_id, kind, id) DO UPDATE
              SET sequence = excluded.sequence, body = excluded.body`,
          )
          .bind(userId, JSON.stringify(chunk), pushId),
      ),
    ]);
    return { accepted: winners.size, applied: moved?.meta.changes === 1 };
  }

  return {
    /** Stores the winners of `changes` and returns how many won. */
    async push(userId: string, changes: readonly Change[]) {
      await ensureAccount(userId);
      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        // A concurrent push for the same account moved its sequence: merge again on top of it.
        // oxlint-disable-next-line eslint/no-await-in-loop -- Each retry depends on the last.
        const result = await pushOnce(userId, changes);
        if (result.applied) return result.accepted;
      }
      throw new Error("Too many concurrent pushes for one account");
    },
    /** The slots that changed above `cursor`, oldest first. */
    async pull(userId: string, cursor: number, limit: number): Promise<PullResult> {
      const rows = await db
        .select({ sequence: syncRecords.sequence, body: syncRecords.body })
        .from(syncRecords)
        .where(and(eq(syncRecords.userId, userId), gt(syncRecords.sequence, cursor)))
        .orderBy(asc(syncRecords.sequence))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      return {
        changes: page.map(({ sequence, body }) => {
          const change = parse(body);
          return change.kind === "tombstone"
            ? { ...change, tombstone: { ...change.tombstone, sequence } }
            : change;
        }),
        cursor: page.at(-1)?.sequence ?? cursor,
        more: rows.length > limit,
      };
    },
  };
}
export type SyncStore = ReturnType<typeof syncStore>;
