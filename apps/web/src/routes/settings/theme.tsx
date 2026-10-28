import { lookAlikes, THEME_SWATCHES, toHex, type ThemeChoice, type ThemeField } from "@app/core";
import { createFileRoute, Link } from "@tanstack/react-router";

import { copy } from "#/copy.ts";
import { resetTheme, setThemeField, useThemeChoice } from "#/theme.ts";
import { Button } from "#/ui/shadcn/button.tsx";

export const Route = createFileRoute("/settings/theme")({
  component: ThemeSettings,
});

type T = ReturnType<typeof copy>;

const FIELDS: ThemeField[] = [
  "lightBackground",
  "darkBackground",
  "primary",
  "secondary",
  "again",
  "hard",
  "good",
  "easy",
];

/** Settings › Theme: swatches or a free color per field, and the look-alike warning. */
function ThemeSettings() {
  const { lang = "pt-BR" } = Route.useSearch();
  const t = copy(lang);
  const choice = useThemeChoice();
  const warnings = lookAlikes(choice).map(([a, b]) => t("lookAlike", { a: t(a), b: t(b) }));
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-6 p-6">
      <Link
        to="/"
        search={lang === "en" ? { lang } : {}}
        className="self-start text-label text-primary-ink underline underline-offset-4"
      >
        ‹ {t("back")}
      </Link>
      <h1 className="text-title font-bold">{t("theme")}</h1>
      {FIELDS.map((field) => (
        <FieldRow key={field} field={field} choice={choice} t={t} />
      ))}
      <p role="status" className="text-label text-attention">
        {warnings.join(" ")}
      </p>
      <Button variant="outline" size="lg" className="self-start" onClick={resetTheme}>
        {t("reset")}
      </Button>
    </main>
  );
}

function FieldRow({ field, choice, t }: { field: ThemeField; choice: ThemeChoice; t: T }) {
  const value = choice[field];
  const color = value === "primary" ? choice.primary : value;
  const free = !THEME_SWATCHES[field].some((swatch) => swatch === value);
  return (
    <fieldset className="flex flex-wrap items-center gap-3">
      <legend className="mb-3 text-body font-bold">{t(field)}</legend>
      {THEME_SWATCHES[field].map((swatch) => (
        <label key={swatch} className="cursor-pointer">
          <input
            type="radio"
            name={field}
            checked={value === swatch}
            onChange={() => setThemeField(field, swatch)}
            className="peer sr-only"
          />
          <span className="sr-only">{swatch === "primary" ? t("sameAsPrimary") : swatch}</span>
          <span
            aria-hidden
            className="block size-10 rounded-full border border-border peer-checked:ring-3 peer-checked:ring-foreground peer-checked:ring-offset-2 peer-checked:ring-offset-background peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ring"
            style={{ backgroundColor: swatch === "primary" ? choice.primary : swatch }}
          />
        </label>
      ))}
      <label title={t("freeColor")} className="relative cursor-pointer">
        <input
          type="color"
          value={color}
          onChange={(event) => {
            const hex = toHex(event.target.value);
            if (hex) setThemeField(field, hex);
          }}
          aria-label={`${t(field)}: ${t("freeColor")}`}
          className="peer absolute inset-0 size-full cursor-pointer opacity-0"
        />
        {/* A free color shows as a selected swatch; otherwise a "+" to pick one. */}
        {free ? (
          <span
            aria-hidden
            className="block size-10 rounded-full border border-border ring-3 ring-foreground ring-offset-2 ring-offset-background peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ring"
            style={{ backgroundColor: color }}
          />
        ) : (
          <span
            aria-hidden
            className="flex size-10 items-center justify-center rounded-full border border-dashed border-muted-foreground text-body text-muted-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ring"
          >
            +
          </span>
        )}
      </label>
    </fieldset>
  );
}
