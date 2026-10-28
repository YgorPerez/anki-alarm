import { Schema } from "effect";
import { readAlarm } from "@app/core";

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
  // Alarms saved before #48 don't read aloud.
  readAloud: Schema.optional(Schema.Unknown),
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
  Schema.Struct({ id: Schema.String, alarm, startedAt: Schema.Number, phase: Schema.String }),
);
const decodeStored = Schema.decodeUnknownSync(Schema.fromJsonString(alarm));
const decodeStoredList = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(alarm)));
const decodeStoredRing = Schema.decodeUnknownSync(Schema.fromJsonString(ring));
export const decodeAlarm = (json: string) => readAlarm(decodeStored(json));
export const decodeAlarms = (json: string) => decodeStoredList(json).map(readAlarm);
export const decodeEvents = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(event)));
export const decodeRing = (json: string) => {
  const active = decodeStoredRing(json);
  return active && { ...active, alarm: readAlarm(active.alarm) };
};
