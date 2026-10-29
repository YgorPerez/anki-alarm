import { Effect, Layer } from "effect";
import native from "../modules/alarm-native/index.ts";
import { AlarmService } from "./alarms.ts";
import { decodeAlarms, decodeAwakeCheck, decodeRing, decodeEvents } from "./alarm-codec.ts";

const attempt = <T>(run: () => T) =>
  Effect.try({ try: run, catch: (error) => new Error(String(error)) });
const settled = <T>(run: () => Promise<T>) =>
  Effect.tryPromise({ try: run, catch: (error) => new Error(String(error)) });
export const androidAlarmService = Layer.succeed(AlarmService, {
  getPermissions: attempt(() => native.getPermissions()),
  request: (kind) => attempt(() => native.request(kind)),
  isOnboardingComplete: attempt(() => native.isOnboardingComplete()),
  completeOnboarding: attempt(() => native.completeOnboarding()),
  capabilities: { canHoldDismissal: true, canTakeOverScreen: true },
  setAlarms: (alarms, policy) =>
    attempt(() => native.setAlarms(JSON.stringify(alarms), JSON.stringify(policy))),
  setAppearance: (colors, locale) =>
    attempt(() => native.setAppearance(JSON.stringify(colors), locale)),
  list: attempt(() => decodeAlarms(native.list())),
  getRing: attempt(() => decodeRing(native.getRing() ?? "null")),
  drainJournal: attempt(() => decodeEvents(native.drainJournal())),
  ack: (ids) => attempt(() => native.ack(ids)),
  sessionStarted: (id) => attempt(() => native.sessionStarted(id)),
  activity: (id) => attempt(() => native.activity(id)),
  snooze: (id, minutes) => attempt(() => decodeRing(native.snooze(id, minutes) ?? "null")),
  dismiss: (id, awakeCheckAfter) => attempt(() => native.dismiss(id, awakeCheckAfter)),
  getAwakeCheck: attempt(() => decodeAwakeCheck(native.getAwakeCheck() ?? "null")),
  awakeCheckPassed: (id) =>
    attempt(() => {
      native.awakeCheckPassed(id);
    }),
  speak: (text, language) => settled(() => native.speak(text, language)),
  playClip: (uri) => settled(() => native.playClip(uri)),
  stopReading: attempt(() => native.stopReading()),
});
export { native };
