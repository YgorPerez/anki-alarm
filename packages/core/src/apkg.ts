/**
 * The parts of an `.apkg` that Core decodes (docs/research/apkg-formats.md). The app unzips the
 * package and zstd-decompresses entries of a Latest package; Core reads `meta` and the media map.
 */

/** Reads protobuf fields as (number, wire type, value). Only varint and length-delimited occur. */
function* protobuf(bytes: Uint8Array): Generator<[number, number | Uint8Array]> {
  let i = 0;
  const varint = () => {
    let result = 0;
    let shift = 1;
    for (;;) {
      if (i >= bytes.length) throw new Error("Truncated protobuf");
      const byte = bytes[i++]!;
      result += (byte & 0x7f) * shift;
      if (byte < 0x80) return result;
      shift *= 128;
    }
  };
  while (i < bytes.length) {
    const key = varint();
    const wire = key % 8;
    const field = Math.floor(key / 8);
    if (wire === 0) yield [field, varint()];
    else if (wire === 2) {
      const length = varint();
      if (i + length > bytes.length) throw new Error("Truncated protobuf");
      yield [field, bytes.subarray(i, i + length)];
      i += length;
    } else if (wire === 5) i += 4;
    else if (wire === 1) i += 8;
    else throw new Error("Unsupported protobuf wire type");
  }
}

/** `meta` is `PackageMetadata { Version version = 1 }`; version 3 (Latest) means zstd. */
export function apkgIsCompressed(meta: Uint8Array | undefined): boolean {
  if (!meta) return false;
  for (const [field, value] of protobuf(meta)) if (field === 1 && value === 3) return true;
  return false;
}

/** A media name Anki would accept, NFC-normalized, or null. */
function mediaName(name: string): string | null {
  const normalized = name.normalize("NFC");
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    /[/\\:*?"<>|]/.test(normalized) ||
    // oxlint-disable-next-line no-control-regex -- Control characters are what is rejected.
    /[\u0000-\u001f\u007f]/.test(normalized)
  )
    return null;
  return normalized;
}

export interface ApkgMediaFile {
  /** The zip entry holding the file. */
  entry: string;
  name: string;
}
/**
 * The package's media files. Legacy: the `media` entry is JSON `{"0": "name"}`. Latest: it is
 * protobuf `MediaEntries`, already decompressed, and entry `i` is the i-th file unless it names
 * its legacy zip file. A missing map is an empty one, as old AnkiDroid builds left it out.
 */
export function apkgMedia(map: Uint8Array | undefined, compressed: boolean): ApkgMediaFile[] {
  if (!map) return [];
  const files: ApkgMediaFile[] = [];
  const add = (entry: string, name: unknown) => {
    const safe = typeof name === "string" ? mediaName(name) : null;
    if (safe) files.push({ entry, name: safe });
  };
  if (!compressed) {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(map));
    if (!parsed || typeof parsed !== "object") throw new Error("Invalid media map");
    for (const [entry, name] of Object.entries(parsed)) add(entry, name);
    return files;
  }
  let index = 0;
  for (const [field, value] of protobuf(map)) {
    if (field !== 1 || typeof value === "number") continue;
    let name: string | undefined;
    let legacy: number | undefined;
    for (const [inner, v] of protobuf(value)) {
      if (inner === 1 && typeof v !== "number") name = new TextDecoder().decode(v);
      if (inner === 255 && typeof v === "number") legacy = v;
    }
    add(String(legacy ?? index), name);
    index++;
  }
  return files;
}
