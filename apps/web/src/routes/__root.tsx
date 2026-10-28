import type { Locale } from "@app/core";
import { createRootRoute, HeadContent, Outlet, ScriptOnce, Scripts } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { copy } from "#/copy.ts";
import { followTheme, THEME_SCRIPT, useStorageState, useStorageError } from "#/theme.ts";

import css from "../styles.css?url";

// The language is in the URL (`?lang=en`) on every page, so a link opens in the language it was
// shared in. The account setting replaces it once there is one.
export const Route = createRootRoute({
  validateSearch: (search: Record<string, unknown>): { lang?: Locale } =>
    search["lang"] === "en" ? { lang: "en" } : {},
  head: ({ match }) => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: copy(match.search.lang ?? "pt-BR")("title") },
    ],
    links: [{ rel: "stylesheet", href: css }],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  const { lang = "pt-BR" } = Route.useSearch();
  useEffect(followTheme, []);
  useEffect(() => {
    if (import.meta.env.PROD && "serviceWorker" in navigator)
      void navigator.serviceWorker.register("/sw.js").catch(console.error);
  }, []);
  const storage = useStorageState();
  const writeError = useStorageError();
  return (
    <html lang={lang}>
      <head>
        <HeadContent />
        <ScriptOnce>{THEME_SCRIPT}</ScriptOnce>
      </head>
      <body>
        {(storage.error || writeError) && (
          <p role="alert" className="p-6 text-body text-destructive">
            {copy(lang)("storageError")}
          </p>
        )}
        {!storage.data && !storage.error ? (
          <p role="status" className="p-6 text-body">
            {copy(lang)("storageLoading")}
          </p>
        ) : (
          children
        )}
        <Scripts />
      </body>
    </html>
  );
}
