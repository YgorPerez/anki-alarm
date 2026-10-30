import type { Alarm } from "./alarm.ts";

export interface AlarmDefaultsInput {
  alarms: readonly Alarm[];
  lastSavedId: string | null;
  deckIds: readonly string[];
}

/** Saved defaults shared by the editor and quick alarms. Quick alarms never supply defaults. */
export function savedAlarmDefaults({
  alarms,
  lastSavedId,
  deckIds,
}: AlarmDefaultsInput): Pick<Alarm, "deckId" | "need" | "sound"> | null {
  const saved = alarms.filter((alarm) => !alarm.quick);
  // Hermes may lack findLast; the copy is fresh.
  // oxlint-disable-next-line unicorn/no-array-reverse
  const newestFirst = [...saved].reverse();
  const last =
    saved.find((alarm) => alarm.id === lastSavedId) ??
    newestFirst.find((alarm) => alarm.deckId !== null) ??
    newestFirst[0];
  if (!last) return null;
  const deckId = last.deckId && deckIds.includes(last.deckId) ? last.deckId : (deckIds[0] ?? null);
  return { deckId, need: last.need, sound: last.sound };
}
