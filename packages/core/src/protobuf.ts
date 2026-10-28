/**
 * A protobuf wire-format reader, enough for Anki's package metadata, media map and schema-18
 * config blobs. Values are grouped by field number in wire order; the caller knows the types.
 */
type WireValue =
  | { wire: 0; value: bigint }
  | { wire: 1; bytes: Uint8Array }
  | { wire: 2; bytes: Uint8Array }
  | { wire: 5; bytes: Uint8Array };

export class Message {
  private readonly fields = new Map<number, WireValue[]>();
  constructor(bytes: Uint8Array) {
    let at = 0;
    const varint = () => {
      let result = 0n;
      for (let shift = 0n; ; shift += 7n) {
        if (at >= bytes.length || shift > 63n) throw new Error("Corrupt protobuf");
        const byte = bytes[at++]!;
        result |= BigInt(byte & 0x7f) << shift;
        if (byte < 0x80) return result;
      }
    };
    const take = (length: number) => {
      if (length < 0 || at + length > bytes.length) throw new Error("Corrupt protobuf");
      const slice = bytes.subarray(at, at + length);
      at += length;
      return slice;
    };
    while (at < bytes.length) {
      const key = varint();
      const field = Number(key >> 3n);
      const wire = Number(key & 7n);
      let value: WireValue;
      if (wire === 0) value = { wire, value: varint() };
      else if (wire === 1) value = { wire, bytes: take(8) };
      else if (wire === 2) value = { wire, bytes: take(Number(varint())) };
      else if (wire === 5) value = { wire, bytes: take(4) };
      else throw new Error("Corrupt protobuf");
      const list = this.fields.get(field) ?? [];
      list.push(value);
      this.fields.set(field, list);
    }
  }
  private last(field: number) {
    return this.fields.get(field)?.at(-1);
  }
  /** Unsigned varint as a bigint: int64 ids don't fit a double. */
  bigint(field: number): bigint | undefined {
    const value = this.last(field);
    return value?.wire === 0 ? value.value : undefined;
  }
  /** Signed int64 as a decimal string. */
  int64(field: number): string | undefined {
    const value = this.bigint(field);
    return value === undefined ? undefined : BigInt.asIntN(64, value).toString();
  }
  number(field: number): number | undefined {
    const value = this.bigint(field);
    return value === undefined ? undefined : Number(BigInt.asIntN(64, value));
  }
  string(field: number): string | undefined {
    const value = this.last(field);
    return value?.wire === 2 ? new TextDecoder().decode(value.bytes) : undefined;
  }
  bytes(field: number): Uint8Array | undefined {
    const value = this.last(field);
    return value?.wire === 2 ? value.bytes : undefined;
  }
  message(field: number): Message | undefined {
    const bytes = this.bytes(field);
    return bytes ? new Message(bytes) : undefined;
  }
  messages(field: number): Message[] {
    return (this.fields.get(field) ?? []).flatMap((v) =>
      v.wire === 2 ? [new Message(v.bytes)] : [],
    );
  }
  float(field: number): number | undefined {
    const value = this.last(field);
    if (value?.wire !== 5) return undefined;
    return single(new DataView(value.bytes.buffer, value.bytes.byteOffset, 4).getFloat32(0, true));
  }
  /** Repeated float, packed or not. */
  floats(field: number): number[] {
    const result: number[] = [];
    for (const value of this.fields.get(field) ?? []) {
      if (value.wire !== 2 && value.wire !== 5) continue;
      const view = new DataView(value.bytes.buffer, value.bytes.byteOffset, value.bytes.length);
      for (let i = 0; i + 4 <= value.bytes.length; i += 4)
        result.push(single(view.getFloat32(i, true)));
    }
    return result;
  }
}
/** A float32 read back as the decimal it was written from: 0.85, not 0.8500000238. */
const single = (value: number) => Number(value.toPrecision(7));
