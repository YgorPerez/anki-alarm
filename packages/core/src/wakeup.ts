/* oxlint-disable unicorn/no-array-sort -- ES2022/Hermes target; only freshly filtered/mapped arrays are sorted. */
import type { LogEntry } from "./study.ts";

/**
 * The kinds native writes to the alarm journal (ADR 0005). A ring's events carry its id; `missed`
 * has none, and `absorbed` names the folded alarm with the ring it joined.
 */
export const ALARM_EVENTS = {
  ringStarted: "ringStarted",
  dismissed: "dismissed",
  screenLeft: "screenLeft",
  screenReturned: "screenReturned",
  serviceRestarted: "serviceRestarted",
  absorbed: "absorbed",
  missed: "missed",
  /** JS asked for a snooze (#46); the ring goes quiet for the snooze length. */
  snoozed: "snoozed",
  /** The snooze timer fired and the ring sounds again. */
  snoozeEnded: "snoozeEnded",
  /** The awake check's prompt opened (#47), on the ring it follows. */
  awakeCheckShown: "awakeCheckShown",
  /** The prompt's card was answered in time. */
  awakeCheckPassed: "awakeCheckPassed",
  /** No answer in time; a new ring with its own id follows. */
  awakeCheckFailed: "awakeCheckFailed",
} as const;
export type AlarmEventKind = (typeof ALARM_EVENTS)[keyof typeof ALARM_EVENTS];

/** One journal event as native wrote it; unknown kinds are kept and ignored. */
export interface AlarmEvent {
  id: string;
  kind: string;
  alarmId: string;
  ringId: string | null;
  /** Wall time, ms since the epoch. */
  wallTime: number;
  /** `SystemClock.elapsedRealtime()`: monotonic, restarts at boot. */
  elapsedRealtime: number;
}

export interface WakeUpOptions {
  now: number;
  /** How many days back the rings count, by when they started. */
  days?: number;
}
export interface WakeUpTally {
  /** Rings that started in the window. */
  rings: number;
  /** Of those, the ones that reached dismissal. */
  dismissed: number;
  /** The median time from ring start to dismissal, snoozes included; null without dismissals. */
  medianDismissMs: number | null;
  snoozes: number;
  /** Snoozes per ring; null without rings. */
  snoozesPerRing: number | null;
  /** Cards answered per dismissed ring before its dismissal, wrong answers included. */
  cardsPerDismissal: number | null;
  awakeChecksPassed: number;
  awakeChecksFailed: number;
  /** Rings lost while the phone was off, more than 30 minutes late at boot. */
  missed: number;
}
export interface WakeUpStats {
  overall: WakeUpTally;
  /** One tally per alarm that rang or was missed in the window, by alarm id. */
  alarms: ({ alarmId: string } & WakeUpTally)[];
}

const DAY = 86_400_000;
const byTime = (a: AlarmEvent, b: AlarmEvent) =>
  a.wallTime - b.wallTime || a.elapsedRealtime - b.elapsedRealtime || a.id.localeCompare(b.id);

/**
 * Time between two events: the monotonic clock, unless it went back (a reboot restarted it),
 * then the wall clock.
 */
function span(from: AlarmEvent, to: AlarmEvent) {
  const monotonic = to.elapsedRealtime - from.elapsedRealtime;
  return monotonic >= 0 ? monotonic : Math.max(0, to.wallTime - from.wallTime);
}

const count = (events: readonly AlarmEvent[], kind: AlarmEventKind) =>
  events.filter((e) => e.kind === kind).length;

interface Ring {
  alarmId: string;
  snoozes: number;
  passed: number;
  failed: number;
  /** Null until dismissed. */
  dismissMs: number | null;
  /** Answers before the dismissal; null until dismissed. */
  cards: number | null;
}

function ring(events: readonly AlarmEvent[], answers: readonly number[]): Ring {
  const start = events[0]!;
  let dismissMs: number | null = null;
  let dismissedAt: number | null = null;
  let elapsed = 0;
  for (let i = 1; i < events.length; i++) {
    elapsed += span(events[i - 1]!, events[i]!);
    if (events[i]!.kind === ALARM_EVENTS.dismissed) {
      dismissMs = elapsed;
      dismissedAt = events[i]!.wallTime;
    }
  }
  return {
    alarmId: start.alarmId,
    snoozes: count(events, ALARM_EVENTS.snoozed),
    passed: count(events, ALARM_EVENTS.awakeCheckPassed),
    failed: count(events, ALARM_EVENTS.awakeCheckFailed),
    dismissMs,
    cards: dismissedAt === null ? null : answers.filter((at) => at <= dismissedAt).length,
  };
}

function median(values: readonly number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);
const mean = (values: readonly number[]) => (values.length ? sum(values) / values.length : null);
const present = <T>(values: readonly (T | null)[]) => values.filter((v): v is T => v !== null);

function tally(rings: readonly Ring[], missed: number): WakeUpTally {
  const dismissed = present(rings.map((r) => r.dismissMs));
  const snoozes = rings.map((r) => r.snoozes);
  return {
    rings: rings.length,
    dismissed: dismissed.length,
    medianDismissMs: median(dismissed),
    snoozes: sum(snoozes),
    snoozesPerRing: mean(snoozes),
    cardsPerDismissal: mean(present(rings.map((r) => r.cards))),
    awakeChecksPassed: sum(rings.map((r) => r.passed)),
    awakeChecksFailed: sum(rings.map((r) => r.failed)),
    missed,
  };
}

/**
 * Wake-up stats from the alarm journal and the review log. A ring counts from its
 * `ringStarted` to its last `dismissed`; its answers are the alarm-session reviews with its id.
 */
export function wakeUpStats(
  events: readonly AlarmEvent[],
  log: readonly LogEntry[],
  { now, days = 30 }: WakeUpOptions,
): WakeUpStats {
  const since = now - days * DAY;
  const byRing = new Map<string, AlarmEvent[]>();
  const missed: string[] = [];
  for (const e of [...events].sort(byTime)) {
    if (e.kind === ALARM_EVENTS.missed && e.wallTime >= since) missed.push(e.alarmId);
    if (e.ringId === null || e.kind === ALARM_EVENTS.absorbed) continue;
    const list = byRing.get(e.ringId);
    if (list) list.push(e);
    else if (e.kind === ALARM_EVENTS.ringStarted && e.wallTime >= since) byRing.set(e.ringId, [e]);
  }
  const voided = new Set(log.filter((e) => e.kind === "void").map((e) => e.targetId));
  const answers = new Map<string, number[]>();
  for (const e of log)
    if (e.kind === "review" && e.origin === "alarm" && e.ringId && !voided.has(e.id))
      answers.set(e.ringId, [...(answers.get(e.ringId) ?? []), e.at]);
  const rings = [...byRing].map(([id, list]) => ring(list, answers.get(id) ?? []));
  const alarmIds = [...new Set([...rings.map((r) => r.alarmId), ...missed])].sort();
  return {
    overall: tally(rings, missed.length),
    alarms: alarmIds.map((alarmId) =>
      Object.assign(
        { alarmId },
        tally(
          rings.filter((r) => r.alarmId === alarmId),
          missed.filter((id) => id === alarmId).length,
        ),
      ),
    ),
  };
}
