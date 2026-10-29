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
  HttpApiSchema,
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
  /** A note's field values, each with its own clock. */
  values: Schema.optional(Schema.Array(Field)),
  /** Anki's own ids, kept for matching and export. */
  anki: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
export const Tombstone = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["decks", "presets", "noteTypes", "notes", "cards", "alarms"]),
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
/**
 * One alarm journal event from a phone (ADR 0005). Like a review it only appends: its id is its
 * slot and the first copy stays. Kinds stay open, as clients ignore the ones they don't know.
 */
export const AlarmEvent = Schema.Struct({
  id: Schema.String,
  kind: Schema.String,
  alarmId: Schema.String,
  ringId: Schema.NullOr(Schema.String),
  wallTime: Schema.Finite,
  elapsedRealtime: Schema.Finite,
});
export const Change = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(SYNC_KINDS), record: FieldRecord }),
  Schema.Struct({ kind: Schema.Literal("tombstone"), tombstone: Tombstone }),
  Schema.Struct({ kind: Schema.Literal("reviewLog"), entry: LogEntry }),
  Schema.Struct({ kind: Schema.Literal("alarmEvent"), event: AlarmEvent }),
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

/** Lowercase hex SHA-256 of a media file's bytes: its key in R2. */
export const Sha256 = Schema.String.check(Schema.isPattern(/^[\da-f]{64}$/));
/** The largest media file sync carries. The Worker holds a file in memory to hash it. */
export const MAX_MEDIA_BYTES = 32 * 1024 * 1024;

export const MissingMediaPayload = Schema.Struct({
  hashes: Schema.Array(Sha256).check(Schema.isMaxLength(MAX_CHANGES)),
});
export type MissingMediaPayload = typeof MissingMediaPayload.Type;
export const MissingMediaResult = Schema.Struct({
  /** The asked hashes the Worker doesn't store yet: upload them before their records. */
  missing: Schema.Array(Sha256),
});
export type MissingMediaResult = typeof MissingMediaResult.Type;
/** `Sha256` of some bytes, through WebCrypto (the Worker, browsers and Node have it). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // A copy, so a view of a larger or shared buffer hashes only its own bytes.
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const MediaBytes = Schema.Uint8Array.pipe(
  HttpApiSchema.asUint8Array({ contentType: "application/octet-stream" }),
);
const MediaParams = { sha256: Sha256 };

/** The uploaded bytes don't hash to the address, or are over `MAX_MEDIA_BYTES`. */
export class MediaRejected extends Schema.TaggedError<MediaRejected>()(
  "MediaRejected",
  { reason: Schema.Literals(["hash", "size"]) },
  { httpApiStatus: 422 },
) {}
/** No such file, or no note of the account references it: the same answer for both. */
export class MediaNotFound extends Schema.TaggedError<MediaNotFound>()(
  "MediaNotFound",
  {},
  { httpApiStatus: 404 },
) {}

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

/**
 * Media files by SHA-256, stored once across all users (ADR 0001 › Media). A client asks which of
 * its files are missing, uploads those, and only then pushes the records that use them. A download
 * needs a note of the account that references the file.
 */
export class SyncMediaApi extends HttpApiGroup.make("media")
  .add(
    HttpApiEndpoint.post("missing", "/sync/media/missing", {
      payload: MissingMediaPayload,
      success: MissingMediaResult,
      error: UpdateRequired,
    }),
    HttpApiEndpoint.put("upload", "/sync/media/:sha256", {
      params: MediaParams,
      payload: MediaBytes,
      success: HttpApiSchema.NoContent,
      error: [UpdateRequired, MediaRejected],
    }),
    HttpApiEndpoint.get("download", "/sync/media/:sha256", {
      params: MediaParams,
      success: MediaBytes,
      error: [UpdateRequired, MediaNotFound],
    }),
  )
  .middleware(Session) {}

export class SyncApi extends HttpApi.make("sync")
  .add(SyncMetadataApi)
  .add(SyncChangesApi)
  .add(SyncMediaApi) {}

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
