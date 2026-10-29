/// <reference lib="webworker" />
import { Serwist, type PrecacheEntry, type SerwistGlobalConfig } from "serwist";

import { SHELL_PAGES } from "./shell.ts";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  // oxlint-disable-next-line eslint/no-underscore-dangle -- Serwist manifest injection point.
  precacheEntries: self.__SW_MANIFEST ?? [],
  skipWaiting: true,
  clientsClaim: true,
  // No generic runtime cache: API, authentication, and cross-origin requests always use network.
  runtimeCaching: [
    // Card media, from the copy of each deck's files in OPFS (#53 fills it on sync).
    {
      matcher: ({ request, url }) =>
        request.method === "GET" &&
        url.origin === self.location.origin &&
        url.pathname.startsWith("/media/"),
      handler: async ({ url }) => {
        try {
          const media = await (await navigator.storage.getDirectory()).getDirectoryHandle("media");
          const name = decodeURIComponent(url.pathname.slice("/media/".length));
          return new Response(await (await media.getFileHandle(name)).getFile());
        } catch {
          return new Response(null, { status: 404 });
        }
      },
    },
    {
      matcher: ({ request, url }) =>
        request.mode === "navigate" &&
        url.origin === self.location.origin &&
        SHELL_PAGES.includes(url.pathname),
      handler: async ({ request, url }) => {
        try {
          return await fetch(request);
        } catch {
          const shell = url.pathname + (url.searchParams.get("lang") === "en" ? "?lang=en" : "");
          return (await serwist.matchPrecache(shell)) ?? Response.error();
        }
      },
    },
  ],
});
serwist.addEventListeners();
