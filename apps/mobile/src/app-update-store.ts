import * as Updates from "expo-updates";

import { createUpdateStore } from "./update-store.ts";
import { downloadApk, fetchOtaInBackground, findApk, openInstaller } from "./updates.ts";

export const appUpdate = createUpdateStore({
  findApk,
  fetchOta: fetchOtaInBackground,
  downloadApk,
  openInstaller,
  restart: () => Updates.reloadAsync(),
  now: Date.now,
});
