import { nextClock, type CollectionEnvironment, type Field, type Tombstone } from "./collection.ts";

/** ISO weekdays: Monday = 1, Sunday = 7. A once-date is a local YYYY-MM-DD. */
export interface AlarmRule {
  hour: number;
  minute: number;
  repeatDays?: readonly number[];
  onceDate?: string;
}

export interface Alarm {
  id: string;
  label: string;
  enabled: boolean;
  rule: AlarmRule;
  vibrate: boolean;
  rampSeconds: number;
  sound: AlarmSound;
  /** The session's deck, subdecks included. Null until the user picks one. */
  deckId: string | null;
  /** N: the cards to rate Good or Easy before the alarm dismisses. */
  need: number;
  /** Whether the ring offers snooze. */
  snooze: boolean;
  /** How long a snooze silences the ring. */
  snoozeMinutes: number;
  /** The snoozes one ring offers. */
  snoozeCap: number;
  /** One card a while after dismissal; no answer in time rings the alarm again. */
  awakeCheck: boolean;
  /** Minutes from dismissal to the awake check's prompt. */
  awakeCheckMinutes: number;
  /** Reads each card's front aloud in the session: its own audio, else TTS. */
  readAloud: boolean;
  /**
   * The time (epoch ms) of one occurrence that won't ring. Once it has passed, or the rule no
   * longer rings then, it has no effect.
   */
  skip: number | null;
  /** A quick alarm (Home's +10/+20/+30 min): it deletes itself once its ring is dismissed. */
  quick: boolean;
}

/** The sounds shipped in the app. Native plays each from `res/raw/alarm_<id>`. */
export const BUNDLED_SOUNDS = ["dawn", "chimes", "classic"] as const;
export type BundledSound = (typeof BUNDLED_SOUNDS)[number];

/**
 * What rings. `default` is the phone's alarm sound. A ringtone (from the system picker) or a file
 * is a URI on this phone; native copies it before the ring, so another phone falls back.
 */
export type AlarmSound =
  | { kind: "default" }
  | { kind: "bundled"; id: BundledSound }
  | { kind: "ringtone" | "file"; uri: string; title: string };

const isBundled = (id: unknown): id is BundledSound => BUNDLED_SOUNDS.some((sound) => sound === id);

/** Reads a stored or synced sound. Anything it doesn't recognize is the phone's alarm sound. */
export function parseAlarmSound(value: unknown): AlarmSound {
  const fields: Partial<Record<string, unknown>> =
    typeof value === "object" && value !== null ? value : {};
  const { kind, id, uri, title } = fields;
  if (kind === "bundled" && isBundled(id)) return { kind, id };
  if ((kind === "ringtone" || kind === "file") && typeof uri === "string" && uri) {
    return { kind, uri, title: typeof title === "string" ? title : "" };
  }
  return { kind: "default" };
}

/** Volume ramp times offered in the editor, in seconds. 0 rings at full volume at once. */
export const RAMP_CHOICES = [0, 15, 30, 60, 120, 300] as const;

export const newAlarm = (id: string): Alarm => ({
  id,
  label: "",
  enabled: true,
  rule: { hour: 7, minute: 0, repeatDays: [1, 2, 3, 4, 5] },
  vibrate: true,
  rampSeconds: 30,
  sound: { kind: "bundled", id: "dawn" },
  deckId: null,
  need: 3,
  snooze: true,
  snoozeMinutes: 9,
  snoozeCap: 2,
  awakeCheck: false,
  awakeCheckMinutes: 5,
  readAloud: false,
  skip: null,
  quick: false,
});

/** The largest N the editor offers. */
export const MAX_NEED = 50;

/** Snooze lengths offered in the editor, in minutes. */
export const SNOOZE_CHOICES = [5, 9, 10, 15, 20, 30] as const;
/** The longest snooze a stored alarm keeps. */
const MAX_SNOOZE_MINUTES = 60;
/** The most snoozes per ring the editor offers. */
export const MAX_SNOOZE_CAP = 10;

/** Awake check delays offered in the editor, in minutes. */
export const AWAKE_CHECK_DELAYS = [1, 3, 5, 10, 15, 30] as const;
const MAX_AWAKE_CHECK_MINUTES = 60;

/** Seconds from dismissal to the awake check, or null when the alarm has none. */
export const awakeCheckAfter = (alarm: Alarm) =>
  alarm.awakeCheck ? alarm.awakeCheckMinutes * 60 : null;

type Upgraded =
  | "sound"
  | "deckId"
  | "need"
  | "snooze"
  | "snoozeMinutes"
  | "snoozeCap"
  | "awakeCheck"
  | "awakeCheckMinutes"
  | "readAloud"
  | "skip"
  | "quick";
type StoredAlarm = Omit<Alarm, Upgraded> & Partial<Record<Upgraded, unknown>>;

/** A whole number kept within `min..max`; anything else is the fallback. */
const wholeIn = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isInteger(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;

/** Reads a stored, synced or native alarm, filling in what older versions didn't save. */
export function readAlarm({
  sound,
  deckId,
  need,
  snooze,
  snoozeMinutes,
  snoozeCap,
  awakeCheck,
  awakeCheckMinutes,
  readAloud,
  skip,
  quick,
  ...alarm
}: StoredAlarm): Alarm {
  const defaults = newAlarm(alarm.id);
  return {
    ...alarm,
    sound: parseAlarmSound(sound),
    deckId: typeof deckId === "string" && deckId ? deckId : null,
    need: wholeIn(need, 1, MAX_NEED, defaults.need),
    snooze: typeof snooze === "boolean" ? snooze : defaults.snooze,
    snoozeMinutes: wholeIn(snoozeMinutes, 1, MAX_SNOOZE_MINUTES, defaults.snoozeMinutes),
    snoozeCap: wholeIn(snoozeCap, 1, MAX_SNOOZE_CAP, defaults.snoozeCap),
    awakeCheck: awakeCheck === true,
    awakeCheckMinutes: wholeIn(
      awakeCheckMinutes,
      1,
      MAX_AWAKE_CHECK_MINUTES,
      defaults.awakeCheckMinutes,
    ),
    readAloud: readAloud === true,
    skip: typeof skip === "number" && Number.isFinite(skip) ? skip : null,
    quick: quick === true,
  };
}

type AlarmProperties = Omit<Alarm, "id">;
/** An alarm as it syncs: one HLC per property (ADR 0001), so edits on two phones both keep. */
export interface AlarmRecord {
  id: string;
  fields: { [K in keyof AlarmProperties]: Field<AlarmProperties[K]> };
}

/** Stamps the properties that differ from `previous`; unchanged ones keep their clock. */
export function stampAlarm(
  previous: AlarmRecord | undefined,
  alarm: Alarm,
  env: CollectionEnvironment,
): AlarmRecord {
  const hlc = nextClock(previous, env);
  const { id, ...properties } = alarm;
  // Every key of the alarm is kept with its own type.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const fields = Object.fromEntries(
    Object.entries(properties).map(([key, value]) => {
      // Object.entries keeps the alarm's keys.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const old = previous?.fields[key as keyof AlarmProperties];
      const kept = old && JSON.stringify(old.value) === JSON.stringify(value);
      return [key, kept ? old : { value, hlc }];
    }),
  ) as AlarmRecord["fields"];
  return { id, fields };
}

/** Deletes an alarm (ADR 0001 › deletes): beats every edit of the record, even a newer one. */
export function alarmTombstone(record: AlarmRecord, env: CollectionEnvironment): Tombstone {
  return { id: record.id, kind: "alarms", sequence: 0, hlc: nextClock(record, env) };
}

/** The alarm a synced record describes. A property it lacks takes the new-alarm default. */
export function alarmFromRecord(record: AlarmRecord): Alarm {
  const defaults = newAlarm(record.id);
  const value = <K extends keyof AlarmProperties>(key: K): AlarmProperties[K] =>
    record.fields[key]?.value ?? defaults[key];
  return readAlarm({
    id: record.id,
    label: value("label"),
    enabled: value("enabled"),
    rule: value("rule"),
    vibrate: value("vibrate"),
    rampSeconds: value("rampSeconds"),
    sound: record.fields.sound?.value,
    deckId: record.fields.deckId?.value,
    need: record.fields.need?.value,
    snooze: record.fields.snooze?.value,
    snoozeMinutes: record.fields.snoozeMinutes?.value,
    snoozeCap: record.fields.snoozeCap?.value,
    awakeCheck: record.fields.awakeCheck?.value,
    awakeCheckMinutes: record.fields.awakeCheckMinutes?.value,
    readAloud: record.fields.readAloud?.value,
    skip: record.fields.skip?.value,
    quick: record.fields.quick?.value,
  });
}

export const RING_POLICY = { leaveSeconds: 10, idleSeconds: 20, awakeCheckSeconds: 60 };

/** Matches java.time: gaps move forward by the gap; overlaps use the earlier offset. */
export function nextRing(rule: AlarmRule, now: number, zone: string): number | null {
  if (
    !Number.isInteger(rule.hour) ||
    rule.hour < 0 ||
    rule.hour > 23 ||
    !Number.isInteger(rule.minute) ||
    rule.minute < 0 ||
    rule.minute > 59
  ) {
    throw new RangeError("Invalid alarm time");
  }
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const civil = (at: number) => {
    const p = Object.fromEntries(
      formatter.formatToParts(at).map((part) => [part.type, part.value]),
    );
    return Date.UTC(
      Number(p["year"]),
      Number(p["month"]) - 1,
      Number(p["day"]),
      Number(p["hour"]),
      Number(p["minute"]),
      Number(p["second"]),
    );
  };
  const localNow = new Date(civil(now));
  const start = rule.onceDate
    ? Date.parse(`${rule.onceDate}T00:00:00Z`)
    : Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate());
  for (let day = 0; day < (rule.onceDate ? 1 : 8); day++) {
    const date = new Date(start + day * 86400000);
    if (!rule.onceDate && !rule.repeatDays?.includes(date.getUTCDay() || 7)) continue;
    const wall = date.getTime() + (rule.hour * 60 + rule.minute) * 60000;
    const offsets = new Set(
      [-86400000, 0, 86400000].map((delta) => civil(wall + delta) - (wall + delta)),
    );
    const candidates = [...offsets].map((offset) => wall - offset);
    const matches = candidates.filter((candidate) => civil(candidate) === wall);
    const at = matches.length ? Math.min(...matches) : Math.max(...candidates);
    if (at !== undefined && at > now) return at;
  }
  return null;
}

export interface NextAlarmRing {
  alarmId: string;
  at: number;
  remainingMs: number;
}

/** The alarm's next ring after `now`, passing over its skipped occurrence. */
export function upcomingRing(alarm: Alarm, now: number, zone: string): number | null {
  const at = nextRing(alarm.rule, now, zone);
  return at !== null && at === alarm.skip ? nextRing(alarm.rule, at, zone) : at;
}

/**
 * What the alarm's menu offers: skipping the next ring of an enabled repeating alarm, or undoing a
 * skip that is still ahead. Null for one-off and disabled alarms.
 */
export function skipOffer(alarm: Alarm, now: number, zone: string): "skip" | "undo" | null {
  if (!alarm.enabled || alarm.rule.onceDate || !alarm.rule.repeatDays?.length) return null;
  const at = nextRing(alarm.rule, now, zone);
  if (at === null) return null;
  return at === alarm.skip ? "undo" : "skip";
}

/** Skips the alarm's next occurrence; it rings again at the one after. */
export const skipNextRing = (alarm: Alarm, now: number, zone: string): Alarm =>
  skipOffer(alarm, now, zone) === "skip"
    ? { ...alarm, skip: nextRing(alarm.rule, now, zone) }
    : alarm;

export const undoSkip = (alarm: Alarm): Alarm => ({ ...alarm, skip: null });

/** Earliest future ring among enabled alarms. Ties keep the input order. */
export function nextAlarmRing(
  alarms: readonly Alarm[],
  now: number,
  zone: string,
): NextAlarmRing | null {
  let next: NextAlarmRing | null = null;
  for (const alarm of alarms) {
    if (!alarm.enabled) continue;
    const at = upcomingRing(alarm, now, zone);
    if (at !== null && (next === null || at < next.at)) {
      next = { alarmId: alarm.id, at, remainingMs: at - now };
    }
  }
  return next;
}

/** Clears a skip once that occurrence has passed, ready to persist and sync. */
export function clearExpiredSkip(alarm: Alarm, now: number): Alarm {
  return alarm.skip !== null && alarm.skip <= now ? { ...alarm, skip: null } : alarm;
}
