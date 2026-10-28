// The sync API: the Worker implements it with `HttpApiBuilder`, and the phone and the web call it
// through the client `HttpApiClient` derives from it. One sync is a push, then pulls from the
// client's cursor. See docs/adr/0001-sync-protocol.md and docs/adr/0007-better-auth.md.
import { SYNC_KINDS, SYNC_PROTOCOL } from "@app/core";
import { Context, Effect, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
} from "effect/http-api";

/** The header every sync request carries Core's `SYNC_PROTOCOL` in. */
export const SYNC_PROTOCOL_HEADER = "x-sync-protocol";
/** The most changes one push may carry, and the most one pull returns. */
export const MAX_CHANGES = 500;

export const Hlc = Schema.Struct({
  wallMs: Schema.Finite,
  counter: Schema.Int,
  deviceId: Schema.String,
});
const Field = Schema.Struct({ value: Schema.Unknown, hlc: Hlc });
/** A record that merges field by field. The Worker doesn't read the values, only their clocks. */
export const FieldRecord = Schema.Struct({
  id: Schema.String,
  fields: Schema.Record(Schema.String, Field),
});
export const Tombstone = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["decks", "presets", "noteTypes", "notes", "cards"]),
  sequence: Schema.Int,
  hlc: Hlc,
});
/** A review log entry (ADR 0003). Only its identity is checked; Core's types define the rest. */
export const LogEntry = Schema.StructWithRest(
  Schema.Struct({
    id: Schema.String,
    cardId: Schema.String,
    at: Schema.Finite,
    kind: Schema.Literals(["review", "snapshot", "reset", "setDueDate", "void"]),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);
export const Change = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(SYNC_KINDS), record: FieldRecord }),
  Schema.Struct({ kind: Schema.Literal("tombstone"), tombstone: Tombstone }),
  Schema.Struct({ kind: Schema.Literal("reviewLog"), entry: LogEntry }),
]);
export type Change = typeof Change.Type;

/** What a client checks before it syncs. */
export const SyncMetadata = Schema.Struct({
  /** Core's `SYNC_PROTOCOL` on the Worker. Sync pauses when it isn't the app's. */
  syncProtocol: Schema.Int,
  serverTime: Schema.DateTimeUtc,
  /** The signed-in account, to tell a different account from the last one. */
  userId: Schema.String,
});
export type SyncMetadata = typeof SyncMetadata.Type;

export const PushPayload = Schema.Struct({
  changes: Schema.Array(Change).check(Schema.isMaxLength(MAX_CHANGES)),
});
export type PushPayload = typeof PushPayload.Type;
export const PushResult = Schema.Struct({
  /** How many changes won and were stored with a new sequence number. */
  accepted: Schema.Int,
});
export type PushResult = typeof PushResult.Type;

export const PullPayload = Schema.Struct({
  /** The highest sequence the client has applied; 0 pulls everything. */
  cursor: Schema.Int,
});
export type PullPayload = typeof PullPayload.Type;
export const PullResult = Schema.Struct({
  changes: Schema.Array(Change),
  /** Store it once the changes are applied, and pull from it next time. */
  cursor: Schema.Int,
  /** More changes wait above the cursor. */
  more: Schema.Boolean,
});
export type PullResult = typeof PullResult.Type;

/** The app's `SYNC_PROTOCOL` isn't the Worker's. Sync pauses until the app updates. */
export class UpdateRequired extends Schema.TaggedError<UpdateRequired>()(
  "UpdateRequired",
  { syncProtocol: Schema.Int },
  { httpApiStatus: 426 },
) {}
/** No better-auth session: sign in again. */
export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized",
  {},
  { httpApiStatus: 401 },
) {}

/** The account of the request's better-auth session. */
export class CurrentUser extends Context.Service<CurrentUser, { readonly id: string }>()(
  "CurrentUser",
) {}
/**
 * Requires a better-auth session. The Worker reads it from the request; a client supplies the
 * session cookie (the phone, through better-auth's Expo client) or lets the browser send it.
 */
export class Session extends HttpApiMiddleware.Service<Session, { provides: CurrentUser }>()(
  "Session",
  { error: Unauthorized, requiredForClient: true },
) {}

export class SyncMetadataApi extends HttpApiGroup.make("metadata")
  .add(
    HttpApiEndpoint.get("metadata", "/sync/metadata", {
      success: SyncMetadata,
      error: UpdateRequired,
    }),
  )
  .middleware(Session) {}

export class SyncChangesApi extends HttpApiGroup.make("changes")
  .add(
    HttpApiEndpoint.post("push", "/sync/push", {
      payload: PushPayload,
      success: PushResult,
      error: UpdateRequired,
    }),
    HttpApiEndpoint.post("pull", "/sync/pull", {
      payload: PullPayload,
      success: PullResult,
      error: UpdateRequired,
    }),
  )
  .middleware(Session) {}

export class SyncApi extends HttpApi.make("sync").add(SyncMetadataApi).add(SyncChangesApi) {}

/** The derived client, however it's built: over fetch in the apps, in memory in tests. */
export type SyncClient = HttpApiClient.ForApi<typeof SyncApi>;

/**
 * The client over fetch. Every request carries Core's `SYNC_PROTOCOL`; `headers` adds the
 * session (the phone's better-auth cookie). `fetch` replaces the global one, as in tests.
 */
export const makeSyncClient = (options: {
  readonly baseUrl: string;
  readonly headers?: () => Record<string, string>;
  readonly fetch?: typeof globalThis.fetch;
}): Effect.Effect<SyncClient> =>
  HttpApiClient.make(SyncApi, {
    baseUrl: options.baseUrl,
    transformClient: HttpClient.mapRequest(
      HttpClientRequest.setHeader(SYNC_PROTOCOL_HEADER, String(SYNC_PROTOCOL)),
    ),
  }).pipe(
    Effect.provide(
      HttpApiMiddleware.layerClient(Session, ({ next, request }) =>
        next(HttpClientRequest.setHeaders(request, options.headers?.() ?? {})),
      ),
    ),
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(
      FetchHttpClient.Fetch,
      options.fetch ?? ((input, init) => globalThis.fetch(input, init)),
    ),
  );
