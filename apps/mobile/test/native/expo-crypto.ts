/// <reference types="node" />
import { createHash, randomBytes } from "node:crypto";

export const getRandomBytes = (size: number) => new Uint8Array(randomBytes(size));

export enum CryptoDigestAlgorithm {
  SHA256 = "SHA-256",
}
export const digest = async (_algorithm: CryptoDigestAlgorithm, data: Uint8Array) => {
  const hash = createHash("sha256").update(data).digest();
  return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength);
};
