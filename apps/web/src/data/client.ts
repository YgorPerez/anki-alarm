/* oxlint-disable unicorn/require-post-message-target-origin -- Workers and BroadcastChannels do not take a target origin. */
// A tab's handle on the database, which lives in one leader tab's Worker (Web Locks owns the
// Worker's lifetime, including VFS installation). Every request is an Effect: it asks who leads,
// sends the operation and waits for the answer, failing typed when storage can't answer.
import { Data, Deferred, Effect, Exit, Fiber, Schedule } from "effect";

import {
  fromFailure,
  WRITES,
  type Args,
  type Kind,
  type LeaderFailed,
  type Message,
  type Operation,
  type Output,
} from "./protocol.ts";

const LONG_OPERATIONS: Partial<Record<Kind, number>> = {
  sync: 120_000,
  importApkg: 600_000,
  exportApkg: 600_000,
};

/** No offline storage in this browser, no leader answered in time, or the tab closed. */
export class StorageUnavailable extends Data.TaggedError("StorageUnavailable")<{
  message: string;
}> {}
export type WebDataError = LeaderFailed | StorageUnavailable;

export interface WebData {
  request: <K extends Kind>(kind: K, ...args: Args<K>) => Effect.Effect<Output<K>, WebDataError>;
  /** After any tab's write or a sync that changed something: refresh what's shown. */
  subscribe: (listener: () => void) => () => void;
  /** After this tab's own writes commit: what schedules its sync. */
  onLocalWrite: (listener: () => void) => () => void;
  close: () => void;
}

const subscription = (set: Set<() => void>) => (listener: () => void) => {
  set.add(listener);
  return () => {
    set.delete(listener);
  };
};

/** One per tab. */
function openWebData(): WebData {
  const channel = new BroadcastChannel("anki-alarm:data:v1");
  const self = crypto.randomUUID();
  let worker: Worker | undefined;
  let leader: string | undefined;
  let failure: string | undefined;
  const listeners = new Set<() => void>();
  const writeListeners = new Set<() => void>();
  const pending = new Map<string, Deferred.Deferred<unknown, WebDataError>>();
  let release: (() => void) | undefined;
  const abort = new AbortController();

  const receive = (message: Message) => {
    if (message.type === "discover" && leader === self)
      channel.postMessage({ type: "leader", id: self });
    if (message.type === "leader") leader = message.id;
    if (message.type === "changed") for (const listener of listeners) listener();
    if (message.type === "request" && message.leader === self) worker?.postMessage(message);
    if (message.type === "response") {
      const deferred = pending.get(message.id);
      if (deferred)
        Deferred.doneUnsafe(
          deferred,
          message.ok ? Exit.succeed(message.result) : Exit.fail(fromFailure(message.error)),
        );
    }
  };
  const changed = () => {
    channel.postMessage({ type: "changed" });
    for (const listener of listeners) listener();
  };
  channel.addEventListener("message", ({ data }: MessageEvent<Message>) => receive(data));
  if (!navigator.locks || !navigator.storage?.getDirectory) {
    failure = "This browser does not support offline storage";
  } else {
    void navigator.locks
      .request("anki-alarm:database:v1", { signal: abort.signal }, async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
          worker = new Worker(new URL("./database.worker.ts", import.meta.url), {
            type: "module",
          });
          worker.addEventListener("message", ({ data }) => {
            if (data.type === "ready") {
              leader = self;
              channel.postMessage({ type: "leader", id: self });
            } else if (data.type === "failed") {
              failure = data.error;
            } else if (data.type === "changed") {
              changed();
            } else {
              receive(data);
              channel.postMessage(data);
            }
          });
          worker.addEventListener("error", (event) => {
            failure = event.message;
          });
        });
        worker?.terminate();
        worker = undefined;
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted) failure = String(error);
      });
  }

  const request = <K extends Kind>(kind: K, ...args: Args<K>) =>
    Effect.gen(function* () {
      // The leader answers with the operation's own result.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const operation = { kind, args } as Operation;
      if (leader !== self) leader = undefined;
      const id = crypto.randomUUID();
      const answer = Deferred.makeUnsafe<unknown, WebDataError>();
      pending.set(id, answer);
      let sent = false;
      /** Sends once a leader is known; until then asks who leads. */
      const send = Effect.sync(() => {
        if (failure) {
          Deferred.doneUnsafe(answer, Exit.fail(new StorageUnavailable({ message: failure })));
          return;
        }
        if (sent) return;
        // Discover before sending so an old leader id is never reused after a handoff.
        if (!leader) {
          channel.postMessage({ type: "discover" });
          return;
        }
        sent = true;
        const message = { type: "request", id, leader, operation } as const;
        if (leader === self) worker?.postMessage(message);
        else channel.postMessage(message);
      });
      const discovery = yield* Effect.forkChild(Effect.repeat(send, Schedule.spaced("100 millis")));
      // A sync waits on the network, and a package is read or written whole; the rest is quick.
      const result = yield* Deferred.await(answer).pipe(
        Effect.timeoutOrElse({
          duration: LONG_OPERATIONS[kind] ?? 20_000,
          orElse: () =>
            Effect.suspend(() => {
              leader = undefined;
              return Effect.fail(
                new StorageUnavailable({
                  message:
                    "Storage unavailable. The operation may have committed; reload before retrying.",
                }),
              );
            }),
        }),
        Effect.ensuring(
          Effect.andThen(
            Effect.sync(() => pending.delete(id)),
            Fiber.interrupt(discovery),
          ),
        ),
      );
      if (WRITES.has(kind)) for (const listener of writeListeners) listener();
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return result as Output<K>;
    });

  return {
    request,
    subscribe: subscription(listeners),
    onLocalWrite: subscription(writeListeners),
    close: () => {
      abort.abort();
      worker?.terminate();
      release?.();
      for (const answer of pending.values())
        Deferred.doneUnsafe(answer, Exit.fail(new StorageUnavailable({ message: "Tab closed" })));
      channel.close();
    },
  };
}

let instance: WebData | undefined;
export const webData = () => (instance ??= openWebData());
/** The Promise adapter for React and TanStack Query: one request, as a promise. */
export const webRequest = <K extends Kind>(kind: K, ...args: Args<K>) =>
  Effect.runPromise(webData().request(kind, ...args));
