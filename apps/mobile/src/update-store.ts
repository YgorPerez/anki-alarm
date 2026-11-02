/* oxlint-disable unicorn/no-array-sort -- Hermes has no toSorted; only fresh arrays are sorted. */
import { create } from "zustand";

const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
/** A download that moves no bytes for this long, watched from the foreground, has failed. */
const STALL_LIMIT = 2 * 60 * 1000;
/** A longer silence between polls means the app was away: it restarts the stall clock. */
const POLL_GAP = 10 * 1000;

/**
 * The card stays off screens where a tap or a restart costs something (ADR 0002): study, the alarm
 * editor's draft, an AnkiDroid import. Settings' own screen has the button instead.
 */
export function showsUpdateCard(pathname: string) {
  return pollsDownload(pathname) && !/^\/settings\/?$/.test(pathname);
}

/** A finished download opens the installer, so it's only watched where that costs nothing. */
export function pollsDownload(pathname: string) {
  return !/^\/(study|alarm|ankidroid)(\/|$)/.test(pathname);
}

export interface Apk {
  version: string;
  url: string;
  size: number;
}

export type ApkDownload =
  | { kind: "idle" }
  | { kind: "downloading"; percent: number }
  | { kind: "ready"; file: string }
  | { kind: "failed" };

export type UpdateOffer =
  | { kind: "apk"; apk: Apk; download: ApkDownload }
  | { kind: "ota"; failed: boolean };

/** One of this app's downloads in the system's DownloadManager. */
export interface DownloadRow {
  id: number;
  version: string;
  status: "active" | "successful" | "failed";
  bytes: number;
  /** Not positive until the server has answered. */
  total: number;
  /** Set once the download succeeded. */
  contentUri: string | null;
}

export interface UpdateDependencies {
  findApk: () => Promise<Apk | undefined>;
  fetchOta: () => Promise<void>;
  listDownloads: () => Promise<DownloadRow[]>;
  startDownload: (apk: Apk) => Promise<number>;
  removeDownload: (id: number) => Promise<void>;
  openInstaller: (file: string) => Promise<void>;
  restart: () => Promise<void>;
  now: () => number;
}

interface UpdateState {
  apk: Apk | undefined;
  download: ApkDownload;
  restartFailed: boolean;
  /** In memory on purpose: the card comes back on the next cold start. */
  dismissed: boolean;
  check: () => Promise<void>;
  acceptApk: () => Promise<void>;
  /** One look at the running download. Called only while the app is in the foreground. */
  pollDownload: () => Promise<void>;
  acceptOta: () => Promise<void>;
  dismiss: () => void;
}

/** A newer APK wins over a downloaded OTA: it already contains the JS. */
export function updateOffer(
  { apk, download, restartFailed }: Pick<UpdateState, "apk" | "download" | "restartFailed">,
  otaPending: boolean,
): UpdateOffer | undefined {
  if (apk) return { kind: "apk", apk, download };
  return otaPending ? { kind: "ota", failed: restartFailed } : undefined;
}

const finishedFirst = { successful: 0, active: 1, failed: 2 };

function percentOf({ bytes, total }: DownloadRow, size: number) {
  return Math.min(100, Math.floor((bytes / (total > 0 ? total : size)) * 100));
}

export function createUpdateStore(dependencies: UpdateDependencies) {
  let checkedAt: number | undefined;
  let checking = false;
  let polling = false;
  /** The DownloadManager row behind `download`. It outlives the app, so a relaunch finds it again. */
  let downloadId: number | undefined;
  /** Only a download accepted in this run opens the installer unasked. */
  let installWhenReady = false;
  const stall = { bytes: 0, progressAt: 0, polledAt: 0 };
  const watch = (bytes: number) => {
    const now = dependencies.now();
    Object.assign(stall, { bytes, progressAt: now, polledAt: now });
  };
  const remove = (id: number) => dependencies.removeDownload(id).catch(() => {});
  /** Removes every download but this version's best one, and returns the state of that one. */
  const reattach = async (apk: Apk | undefined): Promise<ApkDownload> => {
    downloadId = undefined;
    const rows = await dependencies.listDownloads().catch(() => []);
    const [current] = rows
      .filter((row) => row.version === apk?.version)
      .sort((a, b) => finishedFirst[a.status] - finishedFirst[b.status] || b.id - a.id);
    await Promise.all(rows.filter((row) => row !== current).map((row) => remove(row.id)));
    if (!current || !apk) return { kind: "idle" };
    if (current.status === "active") {
      downloadId = current.id;
      watch(current.bytes);
      return { kind: "downloading", percent: percentOf(current, apk.size) };
    }
    if (current.contentUri) {
      downloadId = current.id;
      return { kind: "ready", file: current.contentUri };
    }
    await remove(current.id);
    return { kind: "failed" };
  };

  return create<UpdateState>((set, get) => {
    const fail = async () => {
      const id = downloadId;
      downloadId = undefined;
      installWhenReady = false;
      set({ download: { kind: "failed" } });
      if (id !== undefined) await remove(id);
    };
    const install = async (file: string) => {
      installWhenReady = false;
      try {
        await dependencies.openInstaller(file);
      } catch {
        // The downloaded file may be why it failed, so a retry downloads again.
        await fail();
      }
    };

    return {
      apk: undefined,
      download: { kind: "idle" },
      restartFailed: false,
      dismissed: false,
      check: async () => {
        const now = dependencies.now();
        if (checking || (checkedAt !== undefined && now - checkedAt < CHECK_INTERVAL)) return;
        checking = true;
        void dependencies.fetchOta();
        try {
          const apk = await dependencies.findApk();
          // A failed check stays due, so the next return to the app tries again.
          checkedAt = now;
          if (get().download.kind === "downloading") return;
          if (apk && apk.url === get().apk?.url) return;
          // With no APK to offer, this also clears what an installed update left behind.
          const download = await reattach(apk);
          set({ apk, download });
        } catch {
          // Offline is ordinary: nothing to tell the user.
        } finally {
          checking = false;
        }
      },
      acceptApk: async () => {
        const { apk, download } = get();
        if (!apk || download.kind === "downloading") return;
        if (download.kind === "ready") {
          await install(download.file);
          return;
        }
        set({ download: { kind: "downloading", percent: 0 } });
        try {
          downloadId = await dependencies.startDownload(apk);
          installWhenReady = true;
          watch(0);
        } catch {
          await fail();
        }
      },
      pollDownload: async () => {
        const { apk, download } = get();
        const id = downloadId;
        if (polling || !apk || download.kind !== "downloading" || id === undefined) return;
        polling = true;
        const rows = await dependencies.listDownloads().catch(() => undefined);
        polling = false;
        const row = rows?.find((candidate) => candidate.id === id);
        const now = dependencies.now();
        if (now - stall.polledAt > POLL_GAP) stall.progressAt = now;
        stall.polledAt = now;
        if (row && row.bytes > stall.bytes) {
          stall.bytes = row.bytes;
          stall.progressAt = now;
        }
        // A query that throws says nothing, so only the stall limit can end it. A row missing from
        // a good answer was removed (by the user, say) and won't come back.
        const finishedUri = row?.status === "successful" ? row.contentUri : null;
        const failed =
          (rows && !row) ||
          row?.status === "failed" ||
          (row?.status === "successful" && !finishedUri) ||
          (row?.status !== "successful" && now - stall.progressAt >= STALL_LIMIT);
        if (failed) {
          await fail();
        } else if (finishedUri) {
          set({ download: { kind: "ready", file: finishedUri } });
          if (installWhenReady) await install(finishedUri);
        } else if (row) {
          const percent = percentOf(row, apk.size);
          if (percent !== download.percent) set({ download: { kind: "downloading", percent } });
        }
      },
      acceptOta: async () => {
        set({ restartFailed: false });
        try {
          await dependencies.restart();
        } catch {
          set({ restartFailed: true });
        }
      },
      dismiss: () => set({ dismissed: true }),
    };
  });
}
