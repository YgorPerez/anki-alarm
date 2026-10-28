import { Context, Effect, Layer } from "effect";
import { RING_POLICY, type Alarm, type AlarmPermissions, type ReliabilityKind } from "@app/core";

export interface Ring {
  id: string;
  alarm: Alarm;
  startedAt: number;
  phase: string;
}
export interface AlarmEvent {
  id: string;
  kind: string;
  alarmId: string;
  ringId: string | null;
  wallTime: number;
  elapsedRealtime: number;
}
interface AlarmPort {
  getPermissions: Effect.Effect<AlarmPermissions, Error>;
  request: (kind: ReliabilityKind | "appInfo") => Effect.Effect<boolean, Error>;
  isOnboardingComplete: Effect.Effect<boolean, Error>;
  completeOnboarding: Effect.Effect<boolean, Error>;
  capabilities: { canHoldDismissal: boolean; canTakeOverScreen: boolean };
  setAlarms: (alarms: readonly Alarm[], policy: typeof RING_POLICY) => Effect.Effect<void, Error>;
  list: Effect.Effect<readonly Alarm[], Error>;
  getRing: Effect.Effect<Ring | null, Error>;
  drainJournal: Effect.Effect<readonly AlarmEvent[], Error>;
  ack: (ids: readonly string[]) => Effect.Effect<void, Error>;
  dismiss: (ringId: string) => Effect.Effect<void, Error>;
}
export class AlarmService extends Context.Service<AlarmService, AlarmPort>()("AlarmService") {}

export interface AlarmRepository {
  list: () => Alarm[];
  save: (alarm: Alarm) => void;
  ingest: (events: readonly AlarmEvent[]) => void;
  events: () => AlarmEvent[];
}
export function alarmController(repository: AlarmRepository) {
  return {
    list: repository.list,
    save: (alarm: Alarm) =>
      Effect.gen(function* () {
        yield* Effect.try({
          try: () => repository.save(alarm),
          catch: (error) => new Error(String(error)),
        });
        const service = yield* AlarmService;
        yield* service.setAlarms(
          repository.list().filter((item) => item.enabled),
          RING_POLICY,
        );
      }),
    resume: Effect.gen(function* () {
      const service = yield* AlarmService;
      yield* service.setAlarms(
        repository.list().filter((item) => item.enabled),
        RING_POLICY,
      );
      const events = yield* service.drainJournal;
      yield* Effect.try({
        try: () => repository.ingest(events),
        catch: (error) => new Error(String(error)),
      });
      yield* service.ack(events.map((event) => event.id));
      return yield* service.getRing;
    }),
  };
}

export function memoryAlarmRepository(): AlarmRepository {
  const alarms = new Map<string, Alarm>();
  const journal = new Map<string, AlarmEvent>();
  return {
    list: () => [...alarms.values()],
    save: (alarm) => {
      alarms.set(alarm.id, alarm);
    },
    ingest: (events) => {
      for (const event of events) journal.set(event.id, event);
    },
    events: () => [...journal.values()],
  };
}
export function memoryAlarmService() {
  let alarms: readonly Alarm[] = [];
  let ring: Ring | null = null;
  let events: AlarmEvent[] = [];
  let complete = false;
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
    list: Effect.sync(() => alarms),
    getRing: Effect.sync(() => ring),
    drainJournal: Effect.sync(() => [...events]),
    ack: (ids) =>
      Effect.sync(() => {
        const acknowledged = new Set(ids);
        events = events.filter((event) => !acknowledged.has(event.id));
      }),
    dismiss: (id) =>
      Effect.sync(() => {
        if (ring?.id === id) ring = null;
      }),
  };
  return {
    permissions: (next: Partial<AlarmPermissions>) => {
      permissions = { ...permissions, ...next };
    },
    layer: Layer.succeed(AlarmService, service),
    deliver: (event: AlarmEvent, active: Ring | null = null) => {
      events.push(event);
      ring = active;
    },
  };
}
