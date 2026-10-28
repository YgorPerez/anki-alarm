import { expect, it } from "vite-plus/test";
import { Effect } from "effect";
import type { Alarm } from "@app/core";
import {
  AlarmService,
  memoryAlarmService,
  memoryAlarmRepository,
  alarmController,
} from "./alarms.ts";

const alarm: Alarm = {
  id: "a",
  label: "Morning",
  enabled: true,
  rule: { hour: 7, minute: 30, repeatDays: [1, 2, 3, 4, 5] },
  vibrate: true,
  rampSeconds: 30,
  sound: { kind: "default" },
  deckId: "deck",
  need: 3,
};
it("saves alarms and replaces the native schedule with every enabled alarm", async () => {
  const native = memoryAlarmService();
  const controller = alarmController(memoryAlarmRepository());
  await Effect.runPromise(controller.save(alarm).pipe(Effect.provide(native.layer)));
  const second = { ...alarm, id: "b", enabled: false };
  await Effect.runPromise(controller.save(second).pipe(Effect.provide(native.layer)));
  expect(
    await Effect.runPromise(
      Effect.flatMap(AlarmService, (service) => service.list).pipe(Effect.provide(native.layer)),
    ),
  ).toEqual([alarm]);
  expect(await Effect.runPromise(controller.list)).toEqual([alarm, second]);
});
it("persists a replayed journal once and acknowledges only after successful storage", async () => {
  const native = memoryAlarmService();
  const repository = memoryAlarmRepository();
  const event = {
    id: "event-1",
    kind: "ringStarted",
    alarmId: "a",
    ringId: "ring-1",
    wallTime: 1000,
    elapsedRealtime: 500,
  };
  native.deliver(event);
  const failing = alarmController({
    ...repository,
    ingest: () => Effect.fail(new Error("disk full")),
  });
  await expect(
    Effect.runPromise(failing.resume.pipe(Effect.provide(native.layer))),
  ).rejects.toThrow("disk full");
  const pending = Effect.flatMap(AlarmService, (service) => service.drainJournal).pipe(
    Effect.provide(native.layer),
  );
  expect(await Effect.runPromise(pending)).toEqual([event]);
  const controller = alarmController(repository);
  await Effect.runPromise(controller.resume.pipe(Effect.provide(native.layer)));
  native.deliver(event);
  await Effect.runPromise(controller.resume.pipe(Effect.provide(native.layer)));
  expect(await Effect.runPromise(repository.events)).toEqual([event]);
  expect(await Effect.runPromise(pending)).toEqual([]);
});
it("recovers the active ring on resume and dismisses only its matching ID", async () => {
  const native = memoryAlarmService();
  const controller = alarmController(memoryAlarmRepository());
  const ring = { id: "ring-1", alarm, startedAt: 1000, phase: "ringing" };
  native.deliver(
    {
      id: "event-1",
      kind: "ringStarted",
      alarmId: alarm.id,
      ringId: ring.id,
      wallTime: 1000,
      elapsedRealtime: 500,
    },
    ring,
  );
  const run = <A>(effect: Effect.Effect<A, Error, AlarmService>) =>
    Effect.runPromise(effect.pipe(Effect.provide(native.layer)));
  await run(Effect.flatMap(AlarmService, (service) => service.dismiss("stale-ring")));
  expect(await run(controller.resume)).toEqual(ring);
  await run(Effect.flatMap(AlarmService, (service) => service.dismiss(ring.id)));
  await run(Effect.flatMap(AlarmService, (service) => service.dismiss(ring.id)));
  expect(await run(controller.resume)).toBeNull();
});
it("re-reads reliability after a settings change and retains onboarding completion", async () => {
  const memory = memoryAlarmService();
  const read = Effect.flatMap(AlarmService, (service) => service.getPermissions).pipe(
    Effect.provide(memory.layer),
  );
  expect((await Effect.runPromise(read)).overlay).toBe("unknown");
  memory.permissions({ overlay: "granted" });
  expect((await Effect.runPromise(read)).overlay).toBe("granted");
  const complete = Effect.flatMap(AlarmService, (service) => service.completeOnboarding).pipe(
    Effect.provide(memory.layer),
  );
  await Effect.runPromise(complete);
  expect(
    await Effect.runPromise(
      Effect.flatMap(AlarmService, (service) => service.isOnboardingComplete).pipe(
        Effect.provide(memory.layer),
      ),
    ),
  ).toBe(true);
});
