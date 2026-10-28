// A fake sync API for tests, as t3code's `apps/web/test/environmentHttpTest.ts`: the contract's
// own handlers through `HttpApiBuilder`, called through the derived client in memory. Responses
// are encoded and decoded by the contract's schemas, so a scenario that answers something the
// Worker couldn't send fails the test. No Node APIs: it runs under jsdom, React Native and the
// browser.
import { Effect, Exit, FileSystem, Layer, ManagedRuntime, Path, Scope } from "effect";
import { Etag, HttpPlatform } from "effect/http";
import { HttpApiBuilder, HttpApiTest } from "effect/http-api";

import { SyncApi, type SyncMetadata } from "./index.ts";

/** The answer to each endpoint. An endpoint the scenario leaves out fails the call. */
export interface FakeSyncApiScenario {
  readonly metadata?: () => Effect.Effect<SyncMetadata>;
}

/** How many times each endpoint was called, with its payloads once endpoints take one. */
export interface FakeSyncApiCalls {
  metadata: number;
}

const unexpected = (endpoint: string) =>
  Effect.die(new Error(`The scenario doesn't answer ${endpoint}`));

const makeClient = (scenario: FakeSyncApiScenario, calls: FakeSyncApiCalls) =>
  HttpApiTest.groups(SyncApi, ["metadata"]).pipe(
    Effect.provide([
      HttpApiBuilder.group(SyncApi, "metadata", (handlers) =>
        handlers.handle("metadata", () => {
          calls.metadata += 1;
          return scenario.metadata?.() ?? unexpected("metadata.metadata");
        }),
      ),
      // What file responses would need. The sync API sends none.
      HttpPlatform.layer.pipe(Layer.provideMerge(FileSystem.layerNoop({}))),
      Path.layer,
      Etag.layerWeak,
    ]),
  );

export type FakeSyncApiClient = Effect.Success<ReturnType<typeof makeClient>>;

export interface FakeSyncApi {
  readonly client: FakeSyncApiClient;
  readonly calls: FakeSyncApiCalls;
  /** Runs a client call as a promise. */
  readonly run: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;
  readonly dispose: () => Promise<void>;
}

export async function fakeSyncApi(scenario: FakeSyncApiScenario): Promise<FakeSyncApi> {
  const calls: FakeSyncApiCalls = { metadata: 0 };
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
