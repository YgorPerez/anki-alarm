import { expect, test } from "vite-plus/test";
import {
  createUpdateStore,
  updateOffer,
  type DownloadRow,
  type UpdateDependencies,
} from "./update-store.ts";

const apk = { version: "0.7.0", url: "https://example.com/0.7.0.apk", size: 100_000_000 };
const HOUR = 60 * 60 * 1000;
const SECOND = 1000;

const row = (overrides: Partial<DownloadRow> = {}): DownloadRow => ({
  id: 1,
  version: "0.7.0",
  status: "active",
  bytes: 0,
  total: 100_000_000,
  contentUri: null,
  ...overrides,
});
const finished = (overrides: Partial<DownloadRow> = {}) =>
  row({ status: "successful", bytes: 100_000_000, contentUri: "content://apk", ...overrides });

function setup(overrides: Partial<UpdateDependencies> = {}, rows: DownloadRow[] = []) {
  const calls = {
    find: 0,
    started: [] as string[],
    removed: [] as number[],
    installed: [] as string[],
    restarts: 0,
  };
  const clock = { now: 0 };
  const downloads = { rows, nextId: 100 };
  const store = createUpdateStore({
    findApk: async () => {
      calls.find++;
      return apk;
    },
    fetchOta: async () => {},
    listDownloads: async () => downloads.rows,
    startDownload: async (started) => {
      calls.started.push(started.version);
      const id = downloads.nextId++;
      downloads.rows = [...downloads.rows, row({ id, version: started.version })];
      return id;
    },
    removeDownload: async (id) => {
      calls.removed.push(id);
      downloads.rows = downloads.rows.filter((candidate) => candidate.id !== id);
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
  /** Changes the running download, as the system's DownloadManager would. */
  const advance = (change: Partial<DownloadRow>) => {
    downloads.rows = downloads.rows.map((candidate) => ({ ...candidate, ...change }));
  };
  const poll = () => store.getState().pollDownload();
  /** One poll a second through `seconds`, as the foreground interval does. */
  const pollFor = async (seconds: number) => {
    /* Each poll has to see the clock of its own second. */
    /* eslint-disable no-await-in-loop */
    for (let elapsed = 0; elapsed < seconds; elapsed++) {
      clock.now += SECOND;
      await poll();
    }
    /* eslint-enable no-await-in-loop */
  };
  return { store, calls, clock, downloads, advance, poll, pollFor };
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

test("the download runs in the system and reports progress when polled", async () => {
  const { store, calls, advance, poll } = setup();
  await store.getState().check();
  await store.getState().acceptApk();
  expect(calls.started).toEqual(["0.7.0"]);
  expect(store.getState().download).toEqual({ kind: "downloading", percent: 0 });
  advance({ bytes: 42_500_000 });
  await poll();
  expect(store.getState().download).toEqual({ kind: "downloading", percent: 42 });
});

test("before the system knows the total, the percentage comes from the release's size", async () => {
  const { store, advance, poll } = setup();
  await store.getState().check();
  await store.getState().acceptApk();
  advance({ bytes: 10_000_000, total: -1 });
  await poll();
  expect(store.getState().download).toEqual({ kind: "downloading", percent: 10 });
});

test("a finished download opens the installer once, and a cancelled install can reopen it", async () => {
  const { store, calls, advance, poll } = setup();
  await store.getState().check();
  await store.getState().acceptApk();
  advance({ status: "successful", bytes: 100_000_000, contentUri: "content://apk" });
  await poll();
  await poll();
  expect(store.getState().download).toEqual({ kind: "ready", file: "content://apk" });
  expect(calls.installed).toEqual(["content://apk"]);
  await store.getState().acceptApk();
  expect(calls.started).toEqual(["0.7.0"]);
  expect(calls.installed).toEqual(["content://apk", "content://apk"]);
});

test("a system failure, such as no space, reaches the retry state and retry starts over", async () => {
  const { store, calls, advance, poll } = setup();
  await store.getState().check();
  await store.getState().acceptApk();
  advance({ status: "failed" });
  await poll();
  expect(store.getState().download).toEqual({ kind: "failed" });
  expect(calls.removed).toEqual([100]);
  await store.getState().acceptApk();
  expect(calls.started).toEqual(["0.7.0", "0.7.0"]);
  expect(store.getState().download).toEqual({ kind: "downloading", percent: 0 });
});

test("a download removed from the system's list fails instead of waiting forever", async () => {
  const { store, downloads, poll } = setup();
  await store.getState().check();
  await store.getState().acceptApk();
  downloads.rows = [];
  await poll();
  expect(store.getState().download).toEqual({ kind: "failed" });
});

test("a failed start reaches the retry state", async () => {
  const { store } = setup({
    startDownload: async () => {
      throw new Error("no external storage");
    },
  });
  await store.getState().check();
  await store.getState().acceptApk();
  expect(store.getState().download).toEqual({ kind: "failed" });
});

test("a download with no progress for two minutes in the foreground fails", async () => {
  const { store, calls, poll, pollFor } = setup();
  await store.getState().check();
  await store.getState().acceptApk();
  await poll();
  await pollFor(119);
  expect(store.getState().download.kind).toBe("downloading");
  await pollFor(1);
  expect(store.getState().download).toEqual({ kind: "failed" });
  expect(calls.removed).toEqual([100]);
});

test("progress resets the stall limit", async () => {
  const { store, advance, poll, pollFor } = setup();
  await store.getState().check();
  await store.getState().acceptApk();
  await poll();
  await pollFor(119);
  advance({ bytes: 1 });
  await pollFor(119);
  expect(store.getState().download.kind).toBe("downloading");
});

test("time away from the foreground doesn't count as a stall", async () => {
  const { store, clock, poll, pollFor } = setup();
  await store.getState().check();
  await store.getState().acceptApk();
  await poll();
  clock.now = HOUR;
  await poll();
  expect(store.getState().download.kind).toBe("downloading");
  await pollFor(120);
  expect(store.getState().download).toEqual({ kind: "failed" });
});

test("a failing query counts as no progress rather than a stuck card", async () => {
  const { store, poll, pollFor } = setup({
    listDownloads: async () => {
      throw new Error("provider gone");
    },
  });
  await store.getState().check();
  await store.getState().acceptApk();
  await poll();
  await pollFor(120);
  expect(store.getState().download).toEqual({ kind: "failed" });
});

test("after a relaunch the offer re-attaches to the running download of its version", async () => {
  const { store, calls, advance, poll } = setup({}, [row({ id: 7, bytes: 30_000_000 })]);
  await store.getState().check();
  expect(store.getState().download).toEqual({ kind: "downloading", percent: 30 });
  await store.getState().acceptApk();
  expect(calls.started).toEqual([]);
  advance({ bytes: 50_000_000 });
  await poll();
  expect(store.getState().download).toEqual({ kind: "downloading", percent: 50 });
});

test("after a relaunch a finished download is ready, without opening the installer by itself", async () => {
  const { store, calls } = setup({}, [finished({ id: 7 })]);
  await store.getState().check();
  expect(store.getState().download).toEqual({ kind: "ready", file: "content://apk" });
  expect(calls.installed).toEqual([]);
  await store.getState().acceptApk();
  expect(calls.started).toEqual([]);
  expect(calls.installed).toEqual(["content://apk"]);
});

test("after a relaunch a download that failed meanwhile offers the retry", async () => {
  const { store, calls } = setup({}, [row({ id: 7, status: "failed" })]);
  await store.getState().check();
  expect(store.getState().download).toEqual({ kind: "failed" });
  expect(calls.removed).toEqual([7]);
});

test("a re-attached download polled to the end doesn't open the installer by itself", async () => {
  const { store, calls, advance, poll } = setup({}, [row({ id: 7 })]);
  await store.getState().check();
  advance({ status: "successful", contentUri: "content://apk" });
  await poll();
  expect(store.getState().download).toEqual({ kind: "ready", file: "content://apk" });
  expect(calls.installed).toEqual([]);
});

test("downloads of other versions are removed, and duplicates keep the most finished", async () => {
  const { store, calls } = setup({}, [
    finished({ id: 1, version: "0.6.0" }),
    row({ id: 2, version: "0.6.5" }),
    row({ id: 3 }),
    finished({ id: 4 }),
    row({ id: 5, status: "failed" }),
  ]);
  await store.getState().check();
  expect(store.getState().download).toEqual({ kind: "ready", file: "content://apk" });
  expect(calls.removed.toSorted((a, b) => a - b)).toEqual([1, 2, 3, 5]);
});

test("with no newer APK, the downloads left over from an installed update are removed", async () => {
  const { store, calls } = setup({ findApk: async () => undefined }, [finished({ id: 1 })]);
  await store.getState().check();
  expect(store.getState().apk).toBeUndefined();
  expect(calls.removed).toEqual([1]);
});

test("a failed release check leaves existing downloads alone", async () => {
  const { store, calls } = setup(
    {
      findApk: async () => {
        throw new Error("offline");
      },
    },
    [finished({ id: 1 })],
  );
  await store.getState().check();
  expect(calls.removed).toEqual([]);
});

test("the offer survives a download query that fails", async () => {
  const { store } = setup({
    listDownloads: async () => {
      throw new Error("download manager disabled");
    },
  });
  await store.getState().check();
  expect(store.getState().apk).toEqual(apk);
  expect(store.getState().download).toEqual({ kind: "idle" });
});

test("a failed install downloads again on retry", async () => {
  let fail = true;
  const { store, calls, advance, poll } = setup({
    openInstaller: async () => {
      if (fail) throw new Error("no installer");
    },
  });
  await store.getState().check();
  await store.getState().acceptApk();
  advance({ status: "successful", contentUri: "content://apk" });
  await poll();
  expect(store.getState().download).toEqual({ kind: "failed" });
  expect(calls.removed).toEqual([100]);
  fail = false;
  await store.getState().acceptApk();
  expect(calls.started).toEqual(["0.7.0", "0.7.0"]);
});

test("a newer APK replaces a downloaded one, but never interrupts a download", async () => {
  const newer = { ...apk, version: "0.8.0", url: "https://example.com/0.8.0.apk" };
  let found = apk;
  const { store, calls, clock, advance, poll } = setup({ findApk: async () => found });
  await store.getState().check();
  await store.getState().acceptApk();
  found = newer;
  clock.now = 6 * HOUR;
  await store.getState().check();
  expect(store.getState().apk).toEqual(apk);
  expect(calls.removed).toEqual([]);
  advance({ status: "successful", contentUri: "content://apk" });
  await poll();
  clock.now = 12 * HOUR;
  await store.getState().check();
  expect(store.getState().apk).toEqual(newer);
  expect(store.getState().download).toEqual({ kind: "idle" });
  expect(calls.removed).toEqual([100]);
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
