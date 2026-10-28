import { Context, Effect, Layer } from "effect";
import { RING_POLICY, type Alarm } from "@app/core";

export interface Ring {
  id: string;
  alarm: Alarm;
  startedAt: number;
  phase: string;
}
import type { AlarmEvent } from "@app/client-data";
export type { AlarmEvent } from "@app/client-data";
interface AlarmPort {
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
      return yield* service.getRing;
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
  let events: AlarmEvent[] = [];
  const service: AlarmPort = {
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
    layer: Layer.succeed(AlarmService, service),
    deliver: (event: AlarmEvent, active: Ring | null = null) => {
      events.push(event);
      ring = active;
    },
  };
}
