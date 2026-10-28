/// <reference lib="webworker" />
import { Serwist, type PrecacheEntry, type SerwistGlobalConfig } from "serwist";

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
    {
      matcher: ({ request, url }) =>
        request.mode === "navigate" &&
        url.origin === self.location.origin &&
        ["/", "/settings/theme"].includes(url.pathname),
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
