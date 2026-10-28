import { Effect, Layer } from "effect";
import native from "../modules/alarm-native/index.ts";
import { AlarmService } from "./alarms.ts";
import { decodeAlarms, decodeRing, decodeEvents } from "./alarm-codec.ts";

const attempt = <T>(run: () => T) =>
  Effect.try({ try: run, catch: (error) => new Error(String(error)) });
export const androidAlarmService = Layer.succeed(AlarmService, {
  getPermissions: attempt(() => native.getPermissions()),
  request: (kind) => attempt(() => native.request(kind)),
  isOnboardingComplete: attempt(() => native.isOnboardingComplete()),
  completeOnboarding: attempt(() => native.completeOnboarding()),
  capabilities: { canHoldDismissal: true, canTakeOverScreen: true },
  setAlarms: (alarms, policy) =>
    attempt(() => native.setAlarms(JSON.stringify(alarms), JSON.stringify(policy))),
  list: attempt(() => decodeAlarms(native.list())),
  getRing: attempt(() => decodeRing(native.getRing() ?? "null")),
  drainJournal: attempt(() => decodeEvents(native.drainJournal())),
  ack: (ids) => attempt(() => native.ack(ids)),
  dismiss: (id) => attempt(() => native.dismiss(id)),
});
export { native };
