import { createFileRoute, Link } from "@tanstack/react-router";

import { copy } from "#/copy.ts";
import { Button } from "#/ui/shadcn/button.tsx";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const { lang = "pt-BR" } = Route.useSearch();
  const t = copy(lang);
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 p-6">
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
      <Link
        to="/settings/theme"
        search={lang === "en" ? { lang } : {}}
        className="self-start text-label text-primary-ink underline underline-offset-4"
      >
        {t("theme")}
      </Link>
    </main>
  );
}
