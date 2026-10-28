import { SYNC_PROTOCOL } from "@app/core";
import { SYNC_PROTOCOL_HEADER } from "@app/contracts";

import { syncHandler } from "./api.ts";
import { makeAuth, type AuthOverrides, type Env } from "./auth.ts";
import { syncStore } from "./store.ts";

export type { Env } from "./auth.ts";

/**
 * The sync service: the health check, better-auth under /api/auth, and the sync API under /sync.
 * A sync request from an app with another `SYNC_PROTOCOL` gets 426 before anything else, so that
 * app pauses sync until it updates and keeps working offline.
 */
export function makeWorker(overrides?: AuthOverrides) {
  // One handler per environment: building the Effect routes once per isolate, not per request.
  const handlers = new WeakMap<Env, ReturnType<typeof build>>();
  const build = (env: Env) => {
    const auth = makeAuth(env, overrides);
    return { auth, sync: syncHandler({ auth, store: syncStore(env.DB) }) };
  };
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const { pathname } = new URL(request.url);
      if (pathname === "/health") return Response.json({ ok: true, syncProtocol: SYNC_PROTOCOL });
      let handler = handlers.get(env);
      if (!handler) handlers.set(env, (handler = build(env)));
      if (pathname.startsWith("/api/auth/")) return handler.auth.handler(request);
      if (pathname === "/sync" || pathname.startsWith("/sync/")) {
        if (request.headers.get(SYNC_PROTOCOL_HEADER) !== String(SYNC_PROTOCOL))
          return Response.json(
            { _tag: "UpdateRequired", syncProtocol: SYNC_PROTOCOL },
            { status: 426 },
          );
        return handler.sync(request);
      }
      return new Response("Not found", { status: 404 });
    },
  } satisfies ExportedHandler<Env>;
}

export default makeWorker();
