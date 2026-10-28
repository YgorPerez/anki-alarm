import { Schema } from "effect";

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
  sound: Schema.NullOr(Schema.String),
});
const event = Schema.Struct({
  id: Schema.String,
  kind: Schema.String,
  alarmId: Schema.String,
  ringId: Schema.NullOr(Schema.String),
  wallTime: Schema.Number,
  elapsedRealtime: Schema.Number,
});
export const decodeAlarms = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(alarm)));
export const decodeEvents = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(event)));
export const decodeRing = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.NullOr(
      Schema.Struct({
        id: Schema.String,
        alarm,
        startedAt: Schema.Number,
        phase: Schema.String,
      }),
    ),
  ),
);
