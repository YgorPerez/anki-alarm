import { Schema } from "effect";
import { readAlarm } from "@app/core";
import type { Ring } from "./alarms.ts";

const alarm = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  enabled: Schema.Boolean,
  rule: Schema.Struct({
    hour: Schema.Number,
    minute: Schema.Number,
    repeatDays: Schema.optional(Schema.Array(Schema.Number)),
    onceDate: Schema.optional(Schema.String),
  }),
  vibrate: Schema.Boolean,
  rampSeconds: Schema.Number,
  // Alarms saved before #45 have `null`; Core reads anything unknown as the phone's alarm sound.
  sound: Schema.Unknown,
  // Alarms saved before #41 have no deck or N; Core fills them in.
  deckId: Schema.optional(Schema.Unknown),
  need: Schema.optional(Schema.Unknown),
  // Alarms saved before #46 have no snooze settings.
  snooze: Schema.optional(Schema.Unknown),
  snoozeMinutes: Schema.optional(Schema.Unknown),
  snoozeCap: Schema.optional(Schema.Unknown),
  // And none before #47 has an awake check.
  awakeCheck: Schema.optional(Schema.Unknown),
  awakeCheckMinutes: Schema.optional(Schema.Unknown),
});
const event = Schema.Struct({
  id: Schema.String,
  kind: Schema.String,
  alarmId: Schema.String,
  ringId: Schema.NullOr(Schema.String),
  wallTime: Schema.Number,
  elapsedRealtime: Schema.Number,
});
const ring = Schema.NullOr(
  Schema.Struct({
    id: Schema.String,
    alarm,
    startedAt: Schema.Number,
    phase: Schema.String,
    // Rings stored before #46 have no snoozes.
    snoozes: Schema.optional(Schema.Number),
    snoozedUntil: Schema.optional(Schema.NullOr(Schema.Number)),
  }),
);
const decodeStored = Schema.decodeUnknownSync(Schema.fromJsonString(alarm));
const decodeStoredList = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(alarm)));
const decodeStoredRing = Schema.decodeUnknownSync(Schema.fromJsonString(ring));
export const decodeAlarm = (json: string) => readAlarm(decodeStored(json));
export const decodeAlarms = (json: string) => decodeStoredList(json).map(readAlarm);
export const decodeEvents = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(event)));
export const decodeRing = (json: string): Ring | null => {
  const active = decodeStoredRing(json);
  return (
    active && {
      ...active,
      alarm: readAlarm(active.alarm),
      snoozes: active.snoozes ?? 0,
      snoozedUntil: active.snoozedUntil ?? null,
    }
  );
};
const awakeCheck = Schema.NullOr(
  Schema.Struct({
    id: Schema.String,
    ringId: Schema.String,
    alarm,
    dueAt: Schema.Number,
    shownAt: Schema.optional(Schema.Number),
  }),
);
const decodeStoredAwakeCheck = Schema.decodeUnknownSync(Schema.fromJsonString(awakeCheck));
export const decodeAwakeCheck = (json: string) => {
  const check = decodeStoredAwakeCheck(json);
  return check && { ...check, alarm: readAlarm(check.alarm), shownAt: check.shownAt ?? null };
};
