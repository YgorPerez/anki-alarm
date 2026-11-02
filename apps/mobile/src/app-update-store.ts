import * as Updates from "expo-updates";

import { createUpdateStore } from "./update-store.ts";
import {
  fetchOtaInBackground,
  findApk,
  listDownloads,
  openInstaller,
  removeDownload,
  startDownload,
} from "./updates.ts";

export const appUpdate = createUpdateStore({
  findApk,
  fetchOta: fetchOtaInBackground,
  listDownloads,
  startDownload,
  removeDownload,
  openInstaller,
  restart: () => Updates.reloadAsync(),
  now: Date.now,
});
