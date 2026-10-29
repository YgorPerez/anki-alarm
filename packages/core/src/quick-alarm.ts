import { newAlarm, type Alarm } from "./alarm.ts";
import { ALARM_EVENTS, type AlarmEvent } from "./wakeup.ts";

/** The minutes Home's quick alarm chips add to now. */
export const QUICK_ALARM_MINUTES = [10, 20, 30] as const;

/** What a quick alarm copies from the most recently saved alarm. */
export type QuickAlarmOptions = Pick<Alarm, "deckId" | "need" | "sound">;

/**
 * The deck, N and sound a quick alarm takes: from the alarm saved last (the newest one when that
 * isn't known), never from another quick alarm. A deck that's gone gives way to the first of
 * `deckIds`. Null without a saved alarm or a deck: Home hides the chips then.
 */
export function quickAlarmOptions({
  alarms,
  lastSavedId,
  deckIds,
}: {
  alarms: readonly Alarm[];
  lastSavedId: string | null;
  deckIds: readonly string[];
}): QuickAlarmOptions | null {
  const saved = alarms.filter((alarm) => !alarm.quick);
  const last = saved.find((alarm) => alarm.id === lastSavedId) ?? saved.at(-1);
  if (!last || deckIds.length === 0) return null;
  const deckId = last.deckId && deckIds.includes(last.deckId) ? last.deckId : deckIds[0]!;
  return { deckId, need: last.need, sound: last.sound };
}

/** A one-off alarm at the minute `minutes` from now, in `zone`, with the copied options. */
export function quickAlarm(
  id: string,
  minutes: number,
  options: QuickAlarmOptions,
  now: number,
  zone: string,
): Alarm {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now + minutes * 60000)
      .map((part) => [part.type, part.value]),
  );
  return {
    ...newAlarm(id),
    ...options,
    rule: {
      hour: Number(parts["hour"]),
      minute: Number(parts["minute"]),
      onceDate: `${parts["year"]}-${parts["month"]}-${parts["day"]}`,
    },
    quick: true,
  };
}

/**
 * The quick alarms whose ring was dismissed, by the journal: rung on their own or folded into
 * another alarm's ring. Deleting them syncs, so they go on every device.
 */
export function quickAlarmsDone(alarms: readonly Alarm[], events: readonly AlarmEvent[]): string[] {
  const dismissed = new Set(
    events.filter((event) => event.kind === ALARM_EVENTS.dismissed).map((event) => event.ringId),
  );
  const done = new Set(
    events
      .filter((event) => event.ringId !== null && dismissed.has(event.ringId))
      .map((event) => event.alarmId),
  );
  return alarms.filter((alarm) => alarm.quick && done.has(alarm.id)).map((alarm) => alarm.id);
}
