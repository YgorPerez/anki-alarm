import type { Locale } from "@app/core";
import { createFileRoute, Link } from "@tanstack/react-router";

import { copy } from "#/copy.ts";
import { Button } from "#/ui/shadcn/button.tsx";

// The language is in the URL (`?lang=en`), so a link opens in the language it was shared in.
// The account setting replaces it once there is one.
export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { lang?: Locale } =>
    search["lang"] === "en" ? { lang: "en" } : {},
  component: Home,
});

function Home() {
  const { lang = "pt-BR" } = Route.useSearch();
  const t = copy(lang);
  return (
    <main lang={lang} className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 p-6">
      <h1 className="text-title font-bold">{t("title")}</h1>
      <p className="text-body text-muted-foreground">{t("tagline")}</p>
      <Button
        size="lg"
        className="self-start"
        nativeButton={false}
        render={<Link to="/" search={lang === "en" ? {} : { lang: "en" }} />}
      >
        {t("switchLanguage")}
      </Button>
    </main>
  );
}
