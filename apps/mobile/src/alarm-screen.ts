import { SESSION_RULES } from "@app/core";
import { Effect, type Layer } from "effect";
import { AlarmService } from "./alarms.ts";

/** What the alarm and awake check screens share besides their components (`alarm-ui.tsx`). */
export const GRADE_DELAY_MS = SESSION_RULES.gradeDelaySeconds * 1000;

/** Sends one signal to native through the screen's `AlarmService` layer. */
export const signalWith =
  (layer: Layer.Layer<AlarmService>) =>
  <A>(send: (service: AlarmService["Service"]) => Effect.Effect<A, Error>) =>
    Effect.runPromise(Effect.flatMap(AlarmService, send).pipe(Effect.provide(layer)));
