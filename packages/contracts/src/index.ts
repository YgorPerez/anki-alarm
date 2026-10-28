// The sync API: the Worker implements it with `HttpApiBuilder`, and the phone and the web call it
// through the client `HttpApiClient` derives from it. A stub for now: #52 adds push, pull and
// sign-in. See docs/adr/0001-sync-protocol.md.
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

/** What a client checks before it syncs. */
export const SyncMetadata = Schema.Struct({
  /** Core's `SYNC_PROTOCOL` on the Worker. Sync pauses when it isn't the app's. */
  syncProtocol: Schema.Int,
  serverTime: Schema.DateTimeUtc,
});
export type SyncMetadata = typeof SyncMetadata.Type;

export class SyncMetadataApi extends HttpApiGroup.make("metadata").add(
  HttpApiEndpoint.get("metadata", "/sync/metadata", { success: SyncMetadata }),
) {}

export class SyncApi extends HttpApi.make("sync").add(SyncMetadataApi) {}
