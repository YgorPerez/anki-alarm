import { Context, Effect, Layer } from "effect";
import { RING_POLICY, type Alarm, type AlarmPermissions, type ReliabilityKind } from "@app/core";

export interface Ring {
  id: string;
  alarm: Alarm;
  startedAt: number;
  /** `ringing`, `session` or `snoozed`. */
  phase: string;
  /** Snoozes so far in this ring: each adds its cost to N. */
  snoozes: number;
  /** When a snoozed ring rings again (epoch ms); null when not snoozed. */
  snoozedUntil: number | null;
}
/**
 * The awake check after a dismissed ring. `shownAt` is null until its delay is over; native fails it
 * (and rings again) `RING_POLICY.awakeCheckSeconds` after it.
 */
export interface AwakeCheck {
  id: string;
  ringId: string;
  alarm: Alarm;
  dueAt: number;
  shownAt: number | null;
}
import type { AlarmEvent } from "@app/client-data";
export type { AlarmEvent } from "@app/client-data";
interface AlarmAppearance {
  background: string;
  foreground: string;
  primary: string;
}
interface AlarmPort {
  getPermissions: Effect.Effect<AlarmPermissions, Error>;
  request: (kind: ReliabilityKind | "appInfo") => Effect.Effect<boolean, Error>;
  isOnboardingComplete: Effect.Effect<boolean, Error>;
  completeOnboarding: Effect.Effect<boolean, Error>;
  capabilities: { canHoldDismissal: boolean; canTakeOverScreen: boolean };
  setAlarms: (alarms: readonly Alarm[], policy: typeof RING_POLICY) => Effect.Effect<void, Error>;
  setAppearance: (colors: AlarmAppearance, locale: string) => Effect.Effect<void, Error>;
  list: Effect.Effect<readonly Alarm[], Error>;
  getRing: Effect.Effect<Ring | null, Error>;
  drainJournal: Effect.Effect<readonly AlarmEvent[], Error>;
  ack: (ids: readonly string[]) => Effect.Effect<void, Error>;
  /**
   * Start tapped: native stops the sound and vibration and begins the idle timer. On a snoozed
   * ring ("Answer now") it also cancels the snooze.
   */
  sessionStarted: (ringId: string) => Effect.Effect<void, Error>;
  /**
   * Silences the ring for `minutes` and counts the snooze; native rings it again with an exact
   * alarm that survives kills and reboots. Returns the ring as native now holds it. JS checks the
   * cap; a ring that isn't active or is already snoozed is left alone.
   */
  snooze: (ringId: string, minutes: number) => Effect.Effect<Ring | null, Error>;
  /** A tap or answer in the session: native restarts the idle timer. */
  activity: (ringId: string) => Effect.Effect<void, Error>;
  /**
   * N right. With `awakeCheckAfter` seconds, native schedules the awake check. Idempotent, and
   * ignores a ring that isn't the active one.
   */
  dismiss: (ringId: string, awakeCheckAfter: number | null) => Effect.Effect<void, Error>;
  getAwakeCheck: Effect.Effect<AwakeCheck | null, Error>;
  /** The check's card was answered. Ignores a check that isn't the pending one. */
  awakeCheckPassed: (checkId: string) => Effect.Effect<void, Error>;
  /**
   * Read aloud: TTS on the alarm stream, so it's heard in silent and Do Not Disturb. Ends when the
   * speech does or is stopped. Native keeps the ring silent and its idle timer held meanwhile.
   */
  speak: (text: string, language: string) => Effect.Effect<void, Error>;
  /** Plays a card's audio file on the alarm stream. False when it couldn't play. */
  playClip: (uri: string) => Effect.Effect<boolean, Error>;
  /** Stops any speech or clip; the promises they returned settle. */
  stopReading: Effect.Effect<void, Error>;
}
export class AlarmService extends Context.Service<AlarmService, AlarmPort>()("AlarmService") {}

export interface AlarmRepository {
  list: Effect.Effect<Alarm[], Error>;
  save: (alarm: Alarm) => Effect.Effect<void, Error>;
  ingest: (events: readonly AlarmEvent[]) => Effect.Effect<void, Error>;
  events: Effect.Effect<AlarmEvent[], Error>;
}
export function alarmController(repository: AlarmRepository) {
  return {
    list: repository.list,
    save: (alarm: Alarm) =>
      Effect.gen(function* () {
        yield* repository.save(alarm);
        const service = yield* AlarmService;
        yield* service.setAlarms(
          (yield* repository.list).filter((item) => item.enabled),
          RING_POLICY,
        );
      }),
    resume: Effect.gen(function* () {
      const service = yield* AlarmService;
      yield* service.setAlarms(
        (yield* repository.list).filter((item) => item.enabled),
        RING_POLICY,
      );
      const events = yield* service.drainJournal;
      yield* repository.ingest(events);
      yield* service.ack(events.map((event) => event.id));
      return { ring: yield* service.getRing, awakeCheck: yield* service.getAwakeCheck };
    }),
  };
}
export function memoryAlarmRepository(): AlarmRepository {
  const alarms = new Map<string, Alarm>();
  const journal = new Map<string, AlarmEvent>();
  return {
    list: Effect.sync(() => [...alarms.values()]),
    save: (alarm) =>
      Effect.sync(() => {
        alarms.set(alarm.id, alarm);
      }),
    ingest: (events) =>
      Effect.sync(() => {
        for (const event of events) journal.set(event.id, event);
      }),
    events: Effect.sync(() => [...journal.values()]),
  };
}
export function memoryAlarmService() {
  let alarms: readonly Alarm[] = [];
  let ring: Ring | null = null;
  let check: AwakeCheck | null = null;
  let events: AlarmEvent[] = [];
  let complete = false;
  const signals: string[] = [];
  const unplayable = new Set<string>();
  let permissions: AlarmPermissions = {
    manufacturer: "unknown",
    sdk: 35,
    installSource: "unknown",
    standbyBucket: null,
    notifications: "unknown",
    overlay: "unknown",
    exactAlarm: "unknown",
    fullScreenIntent: "unknown",
    battery: "unknown",
    backgroundRestricted: "unknown",
  };
  const service: AlarmPort = {
    getPermissions: Effect.sync(() => ({ ...permissions })),
    request: () => Effect.succeed(true),
    isOnboardingComplete: Effect.sync(() => complete),
    completeOnboarding: Effect.sync(() => {
      complete = true;
      return true;
    }),
    capabilities: { canHoldDismissal: true, canTakeOverScreen: true },
    setAlarms: (list) =>
      Effect.sync(() => {
        alarms = [...list];
      }),
    setAppearance: () => Effect.void,
    list: Effect.sync(() => alarms),
    getRing: Effect.sync(() => ring),
    drainJournal: Effect.sync(() => [...events]),
    ack: (ids) =>
      Effect.sync(() => {
        const acknowledged = new Set(ids);
        events = events.filter((event) => !acknowledged.has(event.id));
      }),
    sessionStarted: (id) =>
      Effect.sync(() => {
        signals.push(`sessionStarted:${id}`);
        if (ring?.id === id) ring = { ...ring, phase: "session", snoozedUntil: null };
      }),
    snooze: (id, minutes) =>
      Effect.sync(() => {
        signals.push(`snooze:${id}:${minutes}`);
        if (ring?.id === id && ring.phase !== "snoozed") {
          ring = {
            ...ring,
            phase: "snoozed",
            snoozes: ring.snoozes + 1,
            snoozedUntil: Date.now() + minutes * 60_000,
          };
        }
        return ring;
      }),
    activity: (id) =>
      Effect.sync(() => {
        signals.push(`activity:${id}`);
      }),
    dismiss: (id, awakeCheckAfter) =>
      Effect.sync(() => {
        signals.push(`dismiss:${id}`);
        if (ring?.id !== id) return;
        if (awakeCheckAfter !== null)
          check = {
            id: `check-${id}`,
            ringId: id,
            alarm: ring.alarm,
            dueAt: Date.now() + awakeCheckAfter * 1000,
            shownAt: null,
          };
        ring = null;
      }),
    getAwakeCheck: Effect.sync(() => check),
    awakeCheckPassed: (id) =>
      Effect.sync(() => {
        signals.push(`awakeCheckPassed:${id}`);
        if (check?.id === id) check = null;
      }),
    speak: (text, language) =>
      Effect.sync(() => {
        signals.push(`speak:${language}:${text}`);
      }),
    playClip: (uri) =>
      Effect.sync(() => {
        signals.push(`playClip:${uri}`);
        return !unplayable.has(uri);
      }),
    stopReading: Effect.sync(() => {
      signals.push("stopReading");
    }),
  };
  return {
    permissions: (next: Partial<AlarmPermissions>) => {
      permissions = { ...permissions, ...next };
    },
    layer: Layer.succeed(AlarmService, service),
    /** Makes `playClip` fail for a file, as native does for a missing or broken one. */
    unplayable: (uri: string) => {
      unplayable.add(uri);
    },
    /** The signals JS sent native, in order, as `kind:ringId` (reading: `speak:lang:text`). */
    signals: () => [...signals],
    ring: () => ring,
    /** The snooze timer fires: the ring rings again under the same id. */
    endSnooze: () => {
      if (ring?.phase === "snoozed") ring = { ...ring, phase: "ringing", snoozedUntil: null };
      return ring;
    },
    awakeCheck: () => check,
    /** The check's delay ran out: native shows the prompt. */
    showAwakeCheck: (at = Date.now()) => {
      if (check) check = { ...check, shownAt: at };
    },
    deliver: (event: AlarmEvent, active: Ring | null = null) => {
      events.push(event);
      ring = active;
    },
  };
}
