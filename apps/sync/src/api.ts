// The contract's implementation with `HttpApiBuilder`. The session middleware asks better-auth
// for the request's session; the handlers read and write D1 through the store.
import { SYNC_PROTOCOL } from "@app/core";
import { CurrentUser, MAX_CHANGES, Session, SyncApi, Unauthorized } from "@app/contracts";
import { Context, DateTime, Effect, Layer } from "effect";
import { HttpRouter, HttpServer, HttpServerRequest } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";

import type { Auth } from "./auth.ts";
import type { SyncStore } from "./store.ts";

class Backend extends Context.Service<Backend, { auth: Auth; store: SyncStore }>()("Backend") {}

const SessionLive = Layer.effect(
  Session,
  Effect.gen(function* () {
    const { auth } = yield* Backend;
    return Session.of((httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const session = yield* Effect.promise(() =>
          auth.api.getSession({ headers: new Headers(request.headers) }),
        );
        if (!session) return yield* new Unauthorized();
        return yield* Effect.provideService(httpEffect, CurrentUser, { id: session.user.id });
      }),
    );
  }),
);

const MetadataLive = HttpApiBuilder.group(SyncApi, "metadata", (handlers) =>
  handlers.handle("metadata", () =>
    Effect.gen(function* () {
      const user = yield* CurrentUser;
      return {
        syncProtocol: SYNC_PROTOCOL,
        serverTime: yield* DateTime.now,
        userId: user.id,
      };
    }),
  ),
);

const ChangesLive = HttpApiBuilder.group(SyncApi, "changes", (handlers) =>
  Effect.gen(function* () {
    const { store } = yield* Backend;
    return handlers
      .handle("push", ({ payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          const accepted = yield* Effect.promise(() => store.push(user.id, payload.changes));
          return { accepted };
        }),
      )
      .handle("pull", ({ payload }) =>
        Effect.flatMap(CurrentUser, (user) =>
          Effect.promise(() => store.pull(user.id, payload.cursor, MAX_CHANGES)),
        ),
      );
  }),
);

/** A web handler for the sync routes over one backend. */
export const syncHandler = (backend: Backend["Service"]) =>
  HttpRouter.toWebHandler(
    HttpApiBuilder.layer(SyncApi).pipe(
      Layer.provide([MetadataLive, ChangesLive]),
      Layer.provide(SessionLive),
      Layer.provide(HttpServer.layerServices),
      Layer.provide(Layer.succeed(Backend, backend)),
    ),
    { disableLogger: true },
  ).handler;
