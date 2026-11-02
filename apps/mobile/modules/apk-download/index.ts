import { requireNativeModule } from "expo";

import type { DownloadRow } from "../../src/update-store.ts";

/** Android's DownloadManager, for the APK update. It only sees this app's own downloads. */
interface NativeApkDownload {
  /** Enqueues the download, tagged with `version`, and resolves with its id. */
  start: (url: string, version: string) => Promise<number>;
  list: () => Promise<DownloadRow[]>;
  /** Cancels the download and deletes its file. */
  remove: (id: number) => Promise<void>;
}
export default requireNativeModule<NativeApkDownload>("ApkDownload");
