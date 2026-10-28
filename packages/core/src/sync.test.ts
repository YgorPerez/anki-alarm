import { describe, expect, test } from "vite-plus/test";
import {
  alarmFromRecord,
  mergeRecord,
  newAlarm,
  resolveChange,
  signInPlan,
  stampAlarm,
  type SyncChange,
  type Note,
  type Hlc,
} from "./index.ts";

const hlc = (wallMs: number, counter = 0, deviceId = "phone"): Hlc => ({
  wallMs,
  counter,
  deviceId,
});
const note = (front: [string, Hlc], back: [string, Hlc]): Note => ({
  id: "note",
  fields: {
    noteTypeId: { value: "basic", hlc: hlc(1) },
    tags: { value: [], hlc: hlc(1) },
  },
  values: [
    { value: front[0], hlc: front[1] },
    { value: back[0], hlc: back[1] },
  ],
});

describe("mergeRecord", () => {
  test("keeps each field's newer edit, so two devices editing different fields both win", () => {
    const phone = note(["casa nova", hlc(20, 0, "phone")], ["house", hlc(1)]);
    const web = note(["casa", hlc(1)], ["home", hlc(15, 0, "web")]);
    const merged = mergeRecord(phone, web);
    expect(merged.values[0]!.value).toBe("casa nova");
    expect(merged.values[1]!.value).toBe("home");
    expect(mergeRecord(web, phone)).toEqual(merged);
  });

  test("orders by wall time, then counter, then device id", () => {
    const a = note(["a", hlc(10, 2, "phone")], ["x", hlc(10, 0, "phone")]);
    const b = note(["b", hlc(10, 1, "web")], ["y", hlc(10, 0, "web")]);
    const merged = mergeRecord(a, b);
    expect(merged.values[0]!.value).toBe("a");
    expect(merged.values[1]!.value).toBe("y");
  });

  test("a wrong phone clock far in the past still loses to a newer edit", () => {
    const stale = note(["old", hlc(5)], ["x", hlc(5)]);
    const fresh = note(["new", hlc(6, 0, "web")], ["x", hlc(5)]);
    expect(mergeRecord(fresh, stale).values[0]!.value).toBe("new");
  });

  test("merges tags, linked decks and Anki ids like any field", () => {
    const tagged = { ...note(["a", hlc(1)], ["b", hlc(1)]), anki: { id: 7, guid: "g" } };
    tagged.fields.tags = { value: ["verb"], hlc: hlc(9, 0, "web") };
    const local = note(["a", hlc(1)], ["b", hlc(1)]);
    const merged = mergeRecord(local, tagged);
    expect(merged.fields.tags.value).toEqual(["verb"]);
    expect(merged.anki).toEqual({ id: 7, guid: "g" });
    const deck = (linkedBy: string | undefined, at: number) => ({
      id: "deck",
      fields: {
        name: { value: "Japanese", hlc: hlc(1) },
        ...(linkedBy ? { linkedBy: { value: linkedBy, hlc: hlc(at, 0, linkedBy) } } : {}),
      },
    });
    expect(mergeRecord(deck(undefined, 0), deck("phone-a", 5)).fields.linkedBy?.value).toBe(
      "phone-a",
    );
    expect(mergeRecord(deck("phone-a", 5), deck("phone-b", 8)).fields.linkedBy?.value).toBe(
      "phone-b",
    );
  });
});

const record = (front: string, at: number): SyncChange => ({
  kind: "notes",
  record: note([front, hlc(at)], ["back", hlc(1)]),
});
const tombstone = (at: number): SyncChange => ({
  kind: "tombstone",
  tombstone: { id: "note", kind: "notes", sequence: 0, hlc: hlc(at) },
});
const review: SyncChange = {
  kind: "reviewLog",
  entry: {
    kind: "review",
    id: "review",
    cardId: "card",
    at: 10,
    grade: 3,
    durationMs: 900,
    origin: "web",
  },
};

describe("resolveChange", () => {
  test("stores a new record and reports nothing when an edit changes nothing", () => {
    expect(resolveChange(undefined, record("casa", 2))).toEqual(record("casa", 2));
    expect(resolveChange(record("casa", 2), record("casa", 2))).toBeUndefined();
    expect(resolveChange(record("casa", 3), record("velha", 2))).toBeUndefined();
    expect(resolveChange(record("velha", 2), record("casa", 3))).toEqual(record("casa", 3));
  });

  test("a delete beats any edit, even a newer one, and the record never comes back", () => {
    expect(resolveChange(record("casa", 50), tombstone(10))).toEqual(tombstone(10));
    expect(resolveChange(tombstone(10), record("casa", 50))).toBeUndefined();
    expect(resolveChange(tombstone(10), tombstone(20))).toBeUndefined();
  });

  test("reviews only append: a review already stored is never replaced", () => {
    expect(resolveChange(undefined, review)).toEqual(review);
    expect(resolveChange(review, review)).toBeUndefined();
  });
});

describe("alarm records", () => {
  const env = { deviceId: "phone", now: () => 1000, random: () => new Uint8Array(16) };
  test("stamp only the properties that changed and read back as the same alarm", () => {
    const alarm = newAlarm("alarm");
    const first = stampAlarm(undefined, alarm, env);
    expect(alarmFromRecord(first)).toEqual(alarm);
    const relabeled = stampAlarm(first, { ...alarm, label: "Work" }, { ...env, now: () => 10 });
    expect(relabeled.fields.enabled).toEqual(first.fields.enabled);
    expect(relabeled.fields.label).toEqual({
      value: "Work",
      hlc: { wallMs: 1000, counter: 1, deviceId: "phone" },
    });
    expect(stampAlarm(relabeled, alarmFromRecord(relabeled), env)).toEqual(relabeled);
  });

  test("merge per property: one phone turns it off while another relabels it", () => {
    const base = stampAlarm(undefined, newAlarm("alarm"), env);
    const off = stampAlarm(
      base,
      { ...alarmFromRecord(base), enabled: false },
      {
        ...env,
        now: () => 2000,
      },
    );
    const renamed = stampAlarm(
      base,
      { ...alarmFromRecord(base), label: "Gym" },
      {
        ...env,
        deviceId: "tablet",
        now: () => 3000,
      },
    );
    expect(alarmFromRecord(mergeRecord(off, renamed))).toMatchObject({
      enabled: false,
      label: "Gym",
    });
  });

  test("a synced sound this phone can't read falls back to the default sound", () => {
    const stamped = stampAlarm(undefined, newAlarm("alarm"), env);
    const synced = {
      ...stamped,
      fields: { ...stamped.fields, sound: { ...stamped.fields.sound } },
    };
    Object.assign(synced.fields.sound, { value: { kind: "mystery" } });
    expect(alarmFromRecord(synced).sound).toEqual({ kind: "default" });
  });
});

describe("signInPlan", () => {
  test("the first account on a device merges local data into it", () => {
    expect(signInPlan(null, "ana")).toBe("merge");
  });
  test("the same account as last time just syncs", () => {
    expect(signInPlan("ana", "ana")).toBe("continue");
  });
  test("a different account than last time asks first", () => {
    expect(signInPlan("ana", "bia")).toBe("ask");
  });
});
