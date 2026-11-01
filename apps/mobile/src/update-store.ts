import { create } from "zustand";

const CHECK_INTERVAL = 6 * 60 * 60 * 1000;

/**
 * The card stays off screens where a tap or a restart costs something (ADR 0002): study, the alarm
 * editor's draft, an AnkiDroid import. Settings' own screen has the button instead.
 */
export function showsUpdateCard(pathname: string) {
  return !/^\/(study|alarm|ankidroid)(\/|$)|^\/settings\/?$/.test(pathname);
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

export interface UpdateDependencies {
  findApk: () => Promise<Apk | undefined>;
  fetchOta: () => Promise<void>;
  downloadApk: (url: string, onProgress: (percent: number) => void) => Promise<string>;
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

export function createUpdateStore(dependencies: UpdateDependencies) {
  let checkedAt: number | undefined;
  let checking = false;
  return create<UpdateState>((set, get) => ({
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
        if (apk?.url === get().apk?.url) return;
        set({ apk, download: { kind: "idle" } });
      } catch {
        // Offline is ordinary: nothing to tell the user.
      } finally {
        checking = false;
      }
    },
    acceptApk: async () => {
      const { apk, download } = get();
      if (!apk || download.kind === "downloading") return;
      try {
        let file;
        if (download.kind === "ready") {
          ({ file } = download);
        } else {
          set({ download: { kind: "downloading", percent: 0 } });
          file = await dependencies.downloadApk(apk.url, (percent) =>
            set({ download: { kind: "downloading", percent } }),
          );
          set({ download: { kind: "ready", file } });
        }
        await dependencies.openInstaller(file);
      } catch {
        // The cached file may be why it failed, so a retry downloads again.
        set({ download: { kind: "failed" } });
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
  }));
}
