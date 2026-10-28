// A fake sync API for tests, as t3code's `apps/web/test/environmentHttpTest.ts`: the contract's
// own handlers through `HttpApiBuilder`, called through the derived client in memory. Requests and
// responses are encoded and decoded by the contract's schemas, so a scenario that answers something
// the Worker couldn't send fails the test. No Node APIs: it runs under jsdom, React Native and the
// browser.
import { resolveChange, syncSlot, SYNC_PROTOCOL, type SyncChange } from "@app/core";
import { DateTime, Effect, Exit, FileSystem, Layer, ManagedRuntime, Path, Scope } from "effect";
import { Etag, HttpPlatform } from "effect/http";
import { HttpApiBuilder, HttpApiMiddleware, HttpApiTest } from "effect/http-api";

import {
  CurrentUser,
  MAX_CHANGES,
  Session,
  SyncApi,
  Unauthorized,
  UpdateRequired,
  type Change,
  type PullPayload,
  type PullResult,
  type PushPayload,
  type PushResult,
  type SyncClient,
  type SyncMetadata,
} from "./index.ts";

/**
 * The answer to each endpoint. An endpoint the scenario leaves out fails the call. `user` is the
 * signed-in account (default `user-1`); null answers every call with Unauthorized.
 */
export interface FakeSyncApiScenario {
  readonly user?: string | null;
  readonly metadata?: (user: string) => Effect.Effect<SyncMetadata, UpdateRequired>;
  readonly push?: (payload: PushPayload, user: string) => Effect.Effect<PushResult, UpdateRequired>;
  readonly pull?: (payload: PullPayload, user: string) => Effect.Effect<PullResult, UpdateRequired>;
}

/** How many times metadata was called, and the payload of every push and pull. */
export interface FakeSyncApiCalls {
  metadata: number;
  push: PushPayload[];
  pull: PullPayload[];
}

const unexpected = (endpoint: string) =>
  Effect.die(new Error(`The scenario doesn't answer ${endpoint}`));

const makeClient = (scenario: FakeSyncApiScenario, calls: FakeSyncApiCalls) => {
  const user = scenario.user === undefined ? "user-1" : scenario.user;
  return HttpApiTest.groups(SyncApi, ["metadata", "changes"]).pipe(
    Effect.provide([
      Layer.mergeAll(
        HttpApiBuilder.group(SyncApi, "metadata", (handlers) =>
          handlers.handle("metadata", () =>
            Effect.flatMap(CurrentUser, ({ id }) => {
              calls.metadata += 1;
              return scenario.metadata?.(id) ?? unexpected("metadata.metadata");
            }),
          ),
        ),
        HttpApiBuilder.group(SyncApi, "changes", (handlers) =>
          handlers
            .handle("push", ({ payload }) =>
              Effect.flatMap(CurrentUser, ({ id }) => {
                calls.push.push(payload);
                return scenario.push?.(payload, id) ?? unexpected("changes.push");
              }),
            )
            .handle("pull", ({ payload }) =>
              Effect.flatMap(CurrentUser, ({ id }) => {
                calls.pull.push(payload);
                return scenario.pull?.(payload, id) ?? unexpected("changes.pull");
              }),
            ),
        ),
      ).pipe(
        // The routes resolve the middleware when they're built, so it's provided and kept.
        Layer.provideMerge(
          Layer.succeed(Session, (httpEffect) =>
            user === null
              ? Effect.fail(new Unauthorized())
              : Effect.provideService(httpEffect, CurrentUser, { id: user }),
          ),
        ),
      ),
      HttpApiMiddleware.layerClient(Session, ({ next, request }) => next(request)),
      // What file responses would need. The sync API sends none.
      HttpPlatform.layer.pipe(Layer.provideMerge(FileSystem.layerNoop({}))),
      Path.layer,
      Etag.layerWeak,
    ]),
  );
};

export type FakeSyncApiClient = SyncClient;

export interface FakeSyncApi {
  readonly client: FakeSyncApiClient;
  readonly calls: FakeSyncApiCalls;
  /** Runs a client call as a promise. */
  readonly run: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;
  readonly dispose: () => Promise<void>;
}

export async function fakeSyncApi(scenario: FakeSyncApiScenario): Promise<FakeSyncApi> {
  const calls: FakeSyncApiCalls = { metadata: 0, push: [], pull: [] };
  const runtime = ManagedRuntime.make(Layer.empty);
  const scope = await runtime.runPromise(Scope.make());
  const client = await runtime.runPromise(
    makeClient(scenario, calls).pipe(Effect.provideService(Scope.Scope, scope)),
  );
  return {
    client,
    calls,
    run: (effect) => runtime.runPromise(effect),
    async dispose() {
      await runtime.runPromise(Scope.close(scope, Exit.void));
      await runtime.dispose();
    },
  };
}

/** The contract validates a change's envelope; Core's types describe its records. */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const toCore = (change: Change) => change as SyncChange;

export interface MemorySyncServer extends Required<Omit<FakeSyncApiScenario, "user">> {
  /** What the server holds for an account, in sequence order. */
  readonly stored: (user: string) => Change[];
}

/**
 * A scenario that behaves like the Worker: it resolves each push with Core's merge, gives every
 * winner the account's next sequence number, and pulls by cursor in pages.
 */
export function memorySyncServer(
  options: { syncProtocol?: number; pageSize?: number } = {},
): MemorySyncServer {
  const syncProtocol = options.syncProtocol ?? SYNC_PROTOCOL;
  const pageSize = options.pageSize ?? MAX_CHANGES;
  const accounts = new Map<
    string,
    { sequence: number; slots: Map<string, { sequence: number; change: Change }> }
  >();
  const account = (user: string) => {
    let found = accounts.get(user);
    if (!found) accounts.set(user, (found = { sequence: 0, slots: new Map() }));
    return found;
  };
  const check = <A>(answer: () => A) =>
    syncProtocol === SYNC_PROTOCOL
      ? Effect.sync(answer)
      : Effect.fail(new UpdateRequired({ syncProtocol }));
  const rows = (user: string) =>
    // oxlint-disable-next-line unicorn/no-array-sort -- ES2022 target; sorts a fresh copy.
    [...account(user).slots.values()].sort((a, b) => a.sequence - b.sequence);
  return {
    metadata: (user) =>
      Effect.succeed({ syncProtocol, serverTime: DateTime.makeUnsafe(Date.now()), userId: user }),
    push: ({ changes }, user) =>
      check(() => {
        const state = account(user);
        let accepted = 0;
        for (const change of changes) {
          const slot = syncSlot(toCore(change));
          const key = `${slot.kind}:${slot.id}`;
          const winner = resolveChange(
            state.slots.has(key) ? toCore(state.slots.get(key)!.change) : undefined,
            toCore(change),
          );
          if (!winner) continue;
          state.sequence += 1;
          accepted += 1;
          state.slots.set(key, { sequence: state.sequence, change: winner });
        }
        return { accepted };
      }),
    pull: ({ cursor }, user) =>
      check(() => {
        const above = rows(user).filter((row) => row.sequence > cursor);
        const page = above.slice(0, pageSize);
        return {
          changes: page.map(({ change, sequence }) =>
            change.kind === "tombstone"
              ? { ...change, tombstone: { ...change.tombstone, sequence } }
              : change,
          ),
          cursor: page.at(-1)?.sequence ?? cursor,
          more: above.length > page.length,
        };
      }),
    stored: (user) => rows(user).map((row) => row.change),
  };
}
