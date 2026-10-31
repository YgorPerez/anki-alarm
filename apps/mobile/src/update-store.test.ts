import { expect, test } from "vite-plus/test";
import { createUpdateStore, updateOffer, type UpdateDependencies } from "./update-store.ts";

const apk = { version: "0.7.0", url: "https://example.com/0.7.0.apk", size: 131_000_000 };
const HOUR = 60 * 60 * 1000;

function setup(overrides: Partial<UpdateDependencies> = {}) {
  const calls = { find: 0, download: 0, installed: [] as string[], restarts: 0 };
  const clock = { now: 0 };
  const store = createUpdateStore({
    findApk: async () => {
      calls.find++;
      return apk;
    },
    fetchOta: async () => {},
    downloadApk: async (_url, onProgress) => {
      calls.download++;
      onProgress(42);
      return "file:///apk";
    },
    openInstaller: async (file) => {
      calls.installed.push(file);
    },
    restart: async () => {
      calls.restarts++;
    },
    now: () => clock.now,
    ...overrides,
  });
  return { store, calls, clock };
}

test("checks at most every 6 hours", async () => {
  const { store, calls, clock } = setup();
  await store.getState().check();
  clock.now = 6 * HOUR - 1;
  await store.getState().check();
  expect(calls.find).toBe(1);
  clock.now = 6 * HOUR;
  await store.getState().check();
  expect(calls.find).toBe(2);
});

test("a failed check is silent and tries again on the next return", async () => {
  let online = false;
  const { store } = setup({
    findApk: async () => {
      if (!online) throw new Error("offline");
      return apk;
    },
  });
  await store.getState().check();
  expect(store.getState().apk).toBeUndefined();
  online = true;
  await store.getState().check();
  expect(store.getState().apk).toEqual(apk);
});

test("a cancelled install reopens the installer without downloading again", async () => {
  const { store, calls } = setup();
  await store.getState().check();
  await store.getState().acceptApk();
  await store.getState().acceptApk();
  expect(calls.download).toBe(1);
  expect(calls.installed).toEqual(["file:///apk", "file:///apk"]);
});

test("the download reports progress and leaves the offer usable after a failure", async () => {
  const seen: unknown[] = [];
  let fail = true;
  const { store } = setup({
    downloadApk: async (_url, onProgress) => {
      onProgress(42);
      seen.push(store.getState().download);
      if (fail) throw new Error("network");
      return "file:///apk";
    },
  });
  await store.getState().check();
  await store.getState().acceptApk();
  expect(seen).toEqual([{ kind: "downloading", percent: 42 }]);
  expect(store.getState().download).toEqual({ kind: "failed" });
  fail = false;
  await store.getState().acceptApk();
  expect(store.getState().download).toEqual({ kind: "ready", file: "file:///apk" });
});

test("a failed install downloads again on retry", async () => {
  let fail = true;
  const { store, calls } = setup({
    openInstaller: async () => {
      if (fail) throw new Error("no installer");
    },
  });
  await store.getState().check();
  await store.getState().acceptApk();
  expect(store.getState().download).toEqual({ kind: "failed" });
  fail = false;
  await store.getState().acceptApk();
  expect(calls.download).toBe(2);
});

test("a newer APK replaces a downloaded one, but never interrupts a download", async () => {
  const newer = { ...apk, version: "0.8.0", url: "https://example.com/0.8.0.apk" };
  let found = apk;
  const pending = Promise.withResolvers<string>();
  const { store, clock } = setup({
    findApk: async () => found,
    downloadApk: () => pending.promise,
  });
  await store.getState().check();
  const accepted = store.getState().acceptApk();
  found = newer;
  clock.now = 6 * HOUR;
  await store.getState().check();
  expect(store.getState().apk).toEqual(apk);
  pending.resolve("file:///apk");
  await accepted;
  clock.now = 12 * HOUR;
  await store.getState().check();
  expect(store.getState().apk).toEqual(newer);
  expect(store.getState().download).toEqual({ kind: "idle" });
});

test("an APK takes priority over a downloaded OTA", () => {
  const download = { kind: "idle" } as const;
  expect(updateOffer({ apk, download, restartFailed: false }, true)?.kind).toBe("apk");
  expect(updateOffer({ apk: undefined, download, restartFailed: false }, true)?.kind).toBe("ota");
  expect(updateOffer({ apk: undefined, download, restartFailed: false }, false)).toBeUndefined();
});

test("accepting an OTA restarts, and a failed restart can be retried", async () => {
  let fail = true;
  const { store } = setup({
    restart: async () => {
      if (fail) throw new Error("reload");
    },
  });
  await store.getState().acceptOta();
  expect(store.getState().restartFailed).toBe(true);
  fail = false;
  await store.getState().acceptOta();
  expect(store.getState().restartFailed).toBe(false);
});
