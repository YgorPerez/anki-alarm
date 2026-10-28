// Media sync (ADR 0001 › Media). Fields reference files by name; a media record maps a name to the
// SHA-256 of its bytes, which is how R2 stores the file, once for everyone. A client uploads a file
// before it pushes the records that use it, and a failed upload holds back only those records.
import { nextClock, type CollectionEnvironment, type Field } from "./collection.ts";
import { importId } from "./ids.ts";
import type { SyncChange } from "./sync.ts";

/** A media file name and the hash of the bytes it holds, synced per account. */
export interface MediaRecord {
  id: string;
  fields: {
    name: Field<string>;
    /** Lowercase hex SHA-256 of the file's bytes: its key in R2. */
    sha256: Field<string>;
    size: Field<number>;
  };
}
export interface MediaFile {
  name: string;
  sha256: string;
  size: number;
}

/**
 * `src` attributes of the tags that load media, as the card renderer resolves them. The name is in
 * group 2, 3 or 4 (double-quoted, single-quoted or bare); quoted names may hold spaces.
 */
export const MEDIA_SRC =
  /(<(?:img|audio|video|source)\b[^>]*?\bsrc=)(?:"([^"]*)"|'([^']*)'|([^"'\s>]+))/gi;
/** The name a `MEDIA_SRC` match found. */
export const srcName = (match: readonly (string | undefined)[]) =>
  match[2] ?? match[3] ?? match[4] ?? "";
/** Anki's `[sound:name]`. */
export const MEDIA_SOUND = /\[sound:([^\]]+)\]/g;
/** A `src` that isn't a local file name: a URL with a scheme, or an absolute path. */
export const isRemoteSrc = (src: string) => /^(?:[a-z][\w+.-]*:|\/)/i.test(src);

/** The text a field's HTML attribute holds. */
export const unescapeHtml = (html: string) =>
  html
    .replace(/<[^>]*>/g, "")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");

/**
 * A media name as Anki stores it: a bare file name in NFC. Undefined for anything that could leave
 * the media folder.
 */
export function safeMediaName(name: string): string | undefined {
  const normal = name.normalize("NFC");
  // oxlint-disable-next-line no-control-regex -- control characters are what this rejects.
  if (!normal || normal === "." || normal === ".." || /[/\\\u0000-\u001f]/.test(normal))
    return undefined;
  return normal;
}

/** The local media files some field values use, in first-use order, each once. */
export function mediaReferences(values: readonly string[]): string[] {
  const names = new Set<string>();
  const add = (raw: string) => {
    const name = safeMediaName(unescapeHtml(raw));
    if (name) names.add(name);
  };
  for (const value of values) {
    const found: { at: number; name: string }[] = [];
    for (const match of value.matchAll(MEDIA_SRC)) {
      const name = srcName(match);
      if (!isRemoteSrc(name)) found.push({ at: match.index, name });
    }
    for (const match of value.matchAll(MEDIA_SOUND))
      found.push({ at: match.index, name: match[1]! });
    // oxlint-disable-next-line unicorn/no-array-sort -- ES2022 target; sorts a local array.
    for (const { name } of found.sort((a, b) => a.at - b.at)) add(name);
  }
  return [...names];
}

/**
 * The media record after a file is stored under `file.name`: new for a new name, re-stamped when
 * the bytes changed, undefined when the record already says this.
 */
export function stampMedia(
  previous: MediaRecord | undefined,
  file: MediaFile,
  env: CollectionEnvironment,
): MediaRecord | undefined {
  if (
    previous?.fields.sha256.value === file.sha256 &&
    previous.fields.name.value === file.name &&
    previous.fields.size.value === file.size
  )
    return undefined;
  const hlc = nextClock(previous, env);
  const field = <T>(old: Field<T> | undefined, value: T) =>
    old && old.value === value ? old : { value, hlc };
  return {
    id: previous?.id ?? importId("media", file.name),
    fields: {
      name: field(previous?.fields.name, file.name),
      sha256: field(previous?.fields.sha256, file.sha256),
      size: field(previous?.fields.size, file.size),
    },
  };
}

/** The file a synced media record describes, or undefined for an unsafe or malformed one. */
export function mediaFromRecord(record: {
  fields: { [key: string]: Field<unknown> };
}): MediaFile | undefined {
  const name = record.fields.name?.value;
  const sha256 = record.fields.sha256?.value;
  const size = record.fields.size?.value;
  if (typeof name !== "string" || typeof sha256 !== "string" || !/^[\da-f]{64}$/.test(sha256))
    return undefined;
  const safe = safeMediaName(name);
  return safe === name ? { name, sha256, size: typeof size === "number" ? size : 0 } : undefined;
}

/**
 * How a push goes around its media. `uploads` are the files its media records point at: upload the
 * ones the Worker lacks first. With the hashes whose upload failed, `held` is what waits for the
 * next sync (those media records, the notes that reference their names, and those notes' cards, so
 * no device gets a card without its note) and `push` the rest.
 */
export function mediaPushPlan(changes: readonly SyncChange[], failed: ReadonlySet<string>) {
  const uploads: { name: string; sha256: string }[] = [];
  const heldNames = new Set<string>();
  for (const change of changes) {
    if (change.kind !== "media") continue;
    const file = mediaFromRecord(change.record);
    if (!file) continue;
    uploads.push({ name: file.name, sha256: file.sha256 });
    if (failed.has(file.sha256)) heldNames.add(file.name);
  }
  const heldNotes = new Set<string>();
  if (heldNames.size > 0)
    for (const change of changes)
      if (
        change.kind === "notes" &&
        mediaReferences((change.record.values ?? []).map((v) => v.value)).some((name) =>
          heldNames.has(name),
        )
      )
        heldNotes.add(change.record.id);
  const holds = (change: SyncChange) => {
    if (heldNames.size === 0) return false;
    if (change.kind === "media") {
      const file = mediaFromRecord(change.record);
      return file !== undefined && heldNames.has(file.name);
    }
    if (change.kind === "notes") return heldNotes.has(change.record.id);
    const noteId = change.kind === "cards" ? change.record.fields["noteId"]?.value : undefined;
    return typeof noteId === "string" && heldNotes.has(noteId);
  };
  return {
    uploads,
    push: changes.filter((change) => !holds(change)),
    held: changes.filter(holds),
  };
}
