// `.apkg` import and export, the same on the phone and the web (ADR 0006): Core reads and writes the
// package, ClientData stores it. Each app keeps only its zip, scratch SQLite and file I/O.
import { apkgFileName, readApkg, writeApkg, type ApkgHost, type ApkgWriteHost } from "@app/core";
import { Data, Effect } from "effect";

import { ClientData, type ImportSummary } from "./index.ts";

/** The file isn't an Anki package Core can read. */
export class ApkgUnreadable extends Data.TaggedError("ApkgUnreadable")<{ cause: unknown }> {}
/** The deck to export no longer exists. */
export class DeckMissing extends Data.TaggedError("DeckMissing")<{ deckId: string }> {}
/** Core couldn't write the package: the scratch database or a media file failed. */
export class ApkgWriteFailed extends Data.TaggedError("ApkgWriteFailed")<{ cause: unknown }> {}

/**
 * Lets Core read the unzipped package, stores its media files and then merges its records. Media
 * go first, so no imported card points at a missing file.
 */
export const importApkg = (host: ApkgHost) =>
  Effect.gen(function* () {
    const data = yield* ClientData;
    const { package: source, media } = yield* Effect.tryPromise({
      try: () => readApkg(host),
      catch: (cause) => new ApkgUnreadable({ cause }),
    });
    yield* data.storeMedia(media);
    const summary: ImportSummary = yield* data.importAnki(source);
    return summary;
  });

/** A deck with its subdecks, scheduling, history and media: the zip entries and the file name. */
export const exportApkg = (deckId: string, host: ApkgWriteHost, now: number) =>
  Effect.gen(function* () {
    const data = yield* ClientData;
    const [collection, log] = yield* Effect.all([data.collection, data.reviewLog]);
    const deck = collection.decks.find((d) => d.id === deckId);
    if (!deck) return yield* new DeckMissing({ deckId });
    const entries = yield* Effect.tryPromise({
      try: () => writeApkg(host, { collection, log, deckId, now }),
      catch: (cause) => new ApkgWriteFailed({ cause }),
    });
    return { name: apkgFileName(deck.fields.name.value), entries };
  });
