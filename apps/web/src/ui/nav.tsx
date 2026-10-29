import type { Locale } from "@app/core";
import { Link } from "@tanstack/react-router";

import { langSearch } from "#/lang.ts";

/** Back to the deck list. */
export function BackLink({ lang, label }: { lang: Locale; label: string }) {
  return (
    <Link
      to="/"
      search={langSearch(lang)}
      className="self-start text-label text-primary-ink underline underline-offset-4"
    >
      ‹ {label}
    </Link>
  );
}
