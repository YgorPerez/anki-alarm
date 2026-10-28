/// <reference types="node" />
import { zstdCompressSync } from "node:zlib";
import { strToU8, zipSync } from "fflate";
import { expect, test } from "vite-plus/test";
import { apkgMediaFiles } from "./apkg-media.ts";

const utf8 = (s: string) => [...new TextEncoder().encode(s)];
const mediaEntry = (name: string) => {
  const bytes = [0x0a, utf8(name).length, ...utf8(name)];
  return [0x0a, bytes.length, ...bytes];
};

test("a Legacy export gives its media files by name", () => {
  const apkg = zipSync({
    "collection.anki21": strToU8("sqlite"),
    media: strToU8(JSON.stringify({ "0": "neko.jpg", "1": "../escape.mp3" })),
    "0": new Uint8Array([1, 2, 3]),
    "1": new Uint8Array([4]),
  });
  expect(apkgMediaFiles(apkg)).toEqual([{ name: "neko.jpg", bytes: new Uint8Array([1, 2, 3]) }]);
});

const z = (bytes: Uint8Array) => new Uint8Array(zstdCompressSync(bytes));
test("a Latest export is zstd-decompressed: the map and each file", () => {
  const apkg = zipSync({
    meta: new Uint8Array([0x08, 0x03]),
    "collection.anki21b": z(strToU8("sqlite")),
    media: z(new Uint8Array([...mediaEntry("neko.jpg"), ...mediaEntry("inu.mp3")])),
    "0": z(new Uint8Array([1, 2, 3])),
    "1": z(new Uint8Array([9, 9])),
  });
  expect(apkgMediaFiles(apkg)).toEqual([
    { name: "neko.jpg", bytes: new Uint8Array([1, 2, 3]) },
    { name: "inu.mp3", bytes: new Uint8Array([9, 9]) },
  ]);
});

test("a file that isn't a package is refused", () => {
  expect(() => apkgMediaFiles(strToU8("not a zip"))).toThrow(/zip/i);
  expect(() => apkgMediaFiles(zipSync({ "notes.txt": strToU8("hi") }))).toThrow("Not an .apkg");
});
