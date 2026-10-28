/// <reference types="node" />
import { randomBytes } from "node:crypto";

export const getRandomBytes = (size: number) => new Uint8Array(randomBytes(size));
