/// <reference types="node" />
// expo-file-system's File and Directory over Node's fs, in a temporary directory per test file.
// `picks` holds the paths the next system file pickers return; empty means the user cancels.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type Part = string | File | Directory;
const resolve = (parts: Part[]) =>
  join(
    ...parts.map((part) => {
      if (typeof part !== "string") return part.path;
      return part.startsWith("file:") ? fileURLToPath(part) : part;
    }),
  );

export class Directory {
  readonly path: string;
  constructor(...parts: Part[]) {
    this.path = resolve(parts);
  }
  get uri() {
    return `${pathToFileURL(this.path).href}/`;
  }
  get exists() {
    return existsSync(this.path);
  }
  create(_options?: object) {
    mkdirSync(this.path, { recursive: true });
  }
}
export class File {
  readonly path: string;
  constructor(...parts: Part[]) {
    this.path = resolve(parts);
  }
  get uri() {
    return pathToFileURL(this.path).href;
  }
  get exists() {
    return existsSync(this.path);
  }
  async bytes() {
    return new Uint8Array(readFileSync(this.path));
  }
  async write(content: Uint8Array | string) {
    writeFileSync(this.path, content);
  }
  static async pickFileAsync(_options?: object) {
    const next = picks.shift();
    return next === undefined
      ? { canceled: true as const, result: null }
      : { canceled: false as const, result: new File(next) };
  }
}
export const picks: string[] = [];
export const Paths = { document: new Directory(mkdtempSync(join(tmpdir(), "expo-document-"))) };
