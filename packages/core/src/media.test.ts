import { describe, expect, test } from "vite-plus/test";
import {
  importId,
  mediaPushPlan,
  mediaReferences,
  safeMediaName,
  stampMedia,
  type SyncChange,
} from "./index.ts";

const env = (now: number, deviceId = "phone") => ({
  now: () => now,
  random: () => new Uint8Array(16),
  deviceId,
});
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

describe("mediaReferences", () => {
  test("finds local image, audio, video and sound names, once each, as the renderer reads them", () => {
    expect(
      mediaReferences([
        "<img src=\"casa.jpg\"> <img src='dog &amp; cat.png'>",
        '[sound:casa.mp3] <video src=clip.webm></video><audio src="casa.mp3">',
        '<img src="https://example.com/remote.png"><img src="/abs.png"><img src="data:image/png;base64,x">',
        '<source src="voz.ogg">',
      ]),
    ).toEqual(["casa.jpg", "dog & cat.png", "casa.mp3", "clip.webm", "voz.ogg"]);
  });

  test("ignores names that could leave the media folder", () => {
    expect(
      mediaReferences(['<img src="../secret.db">', "[sound:a\\b.mp3]", "[sound:ok.mp3]"]),
    ).toEqual(["ok.mp3"]);
  });
});

test("safeMediaName accepts bare NFC names and rejects paths", () => {
  expect(safeMediaName("café.jpg".normalize("NFD"))).toBe("café.jpg".normalize("NFC"));
  for (const name of ["", ".", "..", "a/b", "a\\b", "x\u0000y"])
    expect(safeMediaName(name)).toBeUndefined();
});

describe("stampMedia", () => {
  test("a new file gets a record whose id comes from its name, so devices share one slot", () => {
    const record = stampMedia(undefined, { name: "casa.jpg", sha256: HASH_A, size: 10 }, env(5));
    expect(record).toEqual({
      id: importId("media", "casa.jpg"),
      fields: {
        name: { value: "casa.jpg", hlc: { wallMs: 5, counter: 0, deviceId: "phone" } },
        sha256: { value: HASH_A, hlc: { wallMs: 5, counter: 0, deviceId: "phone" } },
        size: { value: 10, hlc: { wallMs: 5, counter: 0, deviceId: "phone" } },
      },
    });
  });

  test("the same bytes again change nothing; new bytes take a newer clock", () => {
    const first = stampMedia(undefined, { name: "casa.jpg", sha256: HASH_A, size: 10 }, env(5))!;
    expect(
      stampMedia(first, { name: "casa.jpg", sha256: HASH_A, size: 10 }, env(9)),
    ).toBeUndefined();
    const second = stampMedia(first, { name: "casa.jpg", sha256: HASH_B, size: 12 }, env(3))!;
    expect(second.fields.sha256).toEqual({
      value: HASH_B,
      hlc: { wallMs: 5, counter: 1, deviceId: "phone" },
    });
    expect(second.fields.name).toEqual(first.fields.name);
  });
});

const media = (name: string, sha256: string): SyncChange => ({
  kind: "media",
  record: stampMedia(undefined, { name, sha256, size: 1 }, env(1))!,
});

const card = (id: string, noteId: string): SyncChange => ({
  kind: "cards",
  record: {
    id,
    fields: { noteId: { value: noteId, hlc: { wallMs: 1, counter: 0, deviceId: "phone" } } },
  },
});

describe("mediaPushPlan", () => {
  const hlc = { wallMs: 1, counter: 0, deviceId: "phone" };
  const note = (id: string, ...values: string[]): SyncChange => ({
    kind: "notes",
    record: {
      id,
      fields: { noteTypeId: { value: "basic", hlc }, tags: { value: [], hlc } },
      values: values.map((value) => ({ value, hlc })),
    },
  });
  const deck: SyncChange = {
    kind: "decks",
    record: { id: "d", fields: { name: { value: "Words", hlc } } },
  };

  test("lists the files the media records in a push point at, to upload first", () => {
    const plan = mediaPushPlan([media("a.jpg", HASH_A), deck, media("b.mp3", HASH_B)], new Set());
    expect(plan.uploads).toEqual([
      { name: "a.jpg", sha256: HASH_A },
      { name: "b.mp3", sha256: HASH_B },
    ]);
    expect(plan.push).toHaveLength(3);
    expect(plan.held).toEqual([]);
  });

  test("a failed upload holds back its media record and only the notes that reference it, with their cards", () => {
    const changes = [
      media("a.jpg", HASH_A),
      media("b.mp3", HASH_B),
      note("n1", '<img src="a.jpg">', "casa"),
      note("n2", "[sound:b.mp3]"),
      note("n3", "plain"),
      deck,
      card("c1", "n1"),
      card("c3", "n3"),
    ];
    const plan = mediaPushPlan(changes, new Set([HASH_A]));
    expect(plan.held).toEqual([changes[0], changes[2], changes[6]]);
    expect(plan.push).toEqual([changes[1], changes[3], changes[4], changes[5], changes[7]]);
  });
});
