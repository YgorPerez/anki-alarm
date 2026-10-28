const rol = (x: number, n: number) => (x << n) | (x >>> (32 - n));
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const format = (bytes: Uint8Array) => {
  const s = hex(bytes);
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
};

/** Caller supplies cryptographically random bytes; Core has no platform dependency. */
export function uuid7(now: number, random: Uint8Array): string {
  if (!Number.isSafeInteger(now) || now < 0 || now > 0xffffffffffff || random.length !== 16) {
    throw new Error("Invalid UUIDv7 input");
  }
  const bytes = random.slice();
  for (let i = 5; i >= 0; i--) {
    bytes[i] = now % 256;
    now = Math.floor(now / 256);
  }
  bytes[6] = (bytes[6]! & 15) | 0x70;
  bytes[8] = (bytes[8]! & 63) | 0x80;
  return format(bytes);
}

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
/** RFC 9562 UUIDv5 of a UTF-8 name in a namespace UUID. */
function uuid5(namespace: string, name: string): string {
  const space = namespace
    .replaceAll("-", "")
    .match(/../g)!
    .map((b) => Number.parseInt(b, 16));
  const digest = sha1(new Uint8Array([...space, ...new TextEncoder().encode(name)])).slice(0, 16);
  digest[6] = (digest[6]! & 15) | 0x50;
  digest[8] = (digest[8]! & 63) | 0x80;
  return format(digest);
}

/** RFC 9562 UUIDv5: note UUID as namespace, decimal zero-based template ordinal as name. */
export function cardId(noteId: string, ordinal: number): string {
  if (!UUID.test(noteId) || !Number.isSafeInteger(ordinal) || ordinal < 0)
    throw new Error("Invalid card identity");
  return uuid5(noteId, String(ordinal));
}

/** Namespace of every id derived from an Anki identity (ADR 0001). Never change it. */
const ANKI_NAMESPACE = "5d1f3b0e-8c4a-4f8e-9a51-2a8e7c0b6d43";
/**
 * The id an imported record takes from its Anki identity, so the same package gives the same ids
 * on every device: a note from its guid, a note type, deck or preset from its Anki id, a review
 * from its card and revlog ids.
 */
export const importId = (kind: "note" | "noteType" | "deck" | "preset" | "review", key: string) =>
  uuid5(ANKI_NAMESPACE, `${kind}:${key}`);

// SHA-1 is required by UUIDv5, not used for passwords or security decisions.
function sha1(input: Uint8Array): Uint8Array {
  const padded = new Uint8Array(Math.ceil((input.length + 9) / 64) * 64);
  padded.set(input);
  padded[input.length] = 128;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, input.length * 8);
  const h: [number, number, number, number, number] = [
    0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0,
  ];
  for (let offset = 0; offset < padded.length; offset += 64) {
    const w = new Int32Array(80);
    for (let i = 0; i < 16; i++) w[i] = view.getInt32(offset + i * 4);
    for (let i = 16; i < 80; i++) w[i] = rol(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1);
    let [a, b, c, d, e] = h;
    for (let i = 0; i < 80; i++) {
      const f =
        i < 20
          ? (b & c) | (~b & d)
          : i < 40
            ? b ^ c ^ d
            : i < 60
              ? (b & c) | (b & d) | (c & d)
              : b ^ c ^ d;
      const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const temp = (rol(a, 5) + f + e + k + w[i]!) | 0;
      e = d;
      d = c;
      c = rol(b, 30);
      b = a;
      a = temp;
    }
    [a, b, c, d, e].forEach((v, i) => {
      h[i] = (h[i]! + v) | 0;
    });
  }
  const result = new Uint8Array(20);
  h.forEach((v, i) => new DataView(result.buffer).setInt32(i * 4, v));
  return result;
}
