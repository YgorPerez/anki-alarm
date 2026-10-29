import { SYNC_PROTOCOL } from "@app/core";
import { SYNC_PROTOCOL_HEADER } from "@app/contracts";

import { syncHandler } from "./api.ts";
import { makeAuth, webOrigins, type AuthOverrides, type Env } from "./auth.ts";
import { mediaStore } from "./media.ts";
import { syncStore } from "./store.ts";

export type { Env } from "./auth.ts";

/**
 * CORS for the web app, which runs on another origin and sends the session cookie. Only the
 * trusted origins get credentials; anyone else gets no CORS headers at all.
 */
function cors(request: Request, env: Env) {
  const origin = request.headers.get("origin");
  if (!origin || !webOrigins(env).includes(origin)) return null;
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    // Whatever the trusted page asks for: besides content-type and the protocol header, Effect's
    // client adds trace headers (b3, traceparent).
    "access-control-allow-headers":
      request.headers.get("access-control-request-headers") ??
      `content-type, ${SYNC_PROTOCOL_HEADER}`,
    "access-control-max-age": "600",
  };
}
const withHeaders = (response: Response, headers: Record<string, string> | null) => {
  const result = new Response(response.body, response);
  result.headers.append("vary", "origin");
  for (const [name, value] of Object.entries(headers ?? {})) result.headers.set(name, value);
  return result;
};

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
    const media = mediaStore(env.DB, env.MEDIA);
    return { auth, sync: syncHandler({ auth, store: syncStore(env.DB), media }) };
  };
  const route = (request: Request, env: Env, pathname: string) => {
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
  };
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const { pathname } = new URL(request.url);
      if (pathname === "/health") return Response.json({ ok: true, syncProtocol: SYNC_PROTOCOL });
      const headers = cors(request, env);
      if (request.method === "OPTIONS")
        return withHeaders(new Response(null, { status: 204 }), headers);
      return withHeaders(await route(request, env, pathname), headers);
    },
  } satisfies ExportedHandler<Env>;
}

export default makeWorker();
