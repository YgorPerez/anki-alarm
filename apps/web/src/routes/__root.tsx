import type { Locale } from "@app/core";
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { copy } from "#/copy.ts";

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
  return (
    <html lang={lang}>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
