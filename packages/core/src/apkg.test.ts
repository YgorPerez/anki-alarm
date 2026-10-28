import { expect, test } from "vite-plus/test";
import { apkgIsCompressed, apkgMedia } from "./index.ts";

const utf8 = (s: string) => [...new TextEncoder().encode(s)];
/** A protobuf MediaEntry: name = 1, size = 2, sha1 = 3, legacy_zip_filename = 255. */
const entry = (name: string, legacy?: number) => {
  const bytes = [0x0a, utf8(name).length, ...utf8(name), 0x10, 0x05, 0x1a, 0x01, 0xff];
  if (legacy !== undefined) bytes.push(0xf8, 0x0f, legacy);
  return [0x0a, bytes.length, ...bytes];
};

test("only Latest packages (meta version 3) are zstd-compressed", () => {
  expect(apkgIsCompressed(undefined)).toBe(false);
  expect(apkgIsCompressed(new Uint8Array([0x08, 0x02]))).toBe(false);
  expect(apkgIsCompressed(new Uint8Array([0x08, 0x03]))).toBe(true);
});

test("Legacy packages map zip entries to media names through JSON", () => {
  const map = new TextEncoder().encode(JSON.stringify({ "0": "cat.jpg", "1": "dog.mp3" }));
  expect(apkgMedia(map, false)).toEqual([
    { entry: "0", name: "cat.jpg" },
    { entry: "1", name: "dog.mp3" },
  ]);
  expect(apkgMedia(undefined, false)).toEqual([]);
});

test("Latest packages list media in protobuf order, numbered by position", () => {
  const map = new Uint8Array([...entry("cat.jpg"), ...entry("café.png", 7)]);
  expect(apkgMedia(map, true)).toEqual([
    { entry: "0", name: "cat.jpg" },
    { entry: "7", name: "café.png" },
  ]);
});

test("unsafe media names are dropped and names are NFC-normalized", () => {
  const map = new TextEncoder().encode(
    JSON.stringify({ "0": "../evil.jpg", "1": "a/b.jpg", "2": "", "3": "café.jpg", "4": ".." }),
  );
  expect(apkgMedia(map, false)).toEqual([{ entry: "3", name: "café.jpg" }]);
});
