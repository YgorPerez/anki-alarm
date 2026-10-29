import { CardState, readDueDays, type Locale, type MemoryState } from "@app/core";
import { useForm } from "@tanstack/react-form";

import { editingCopy } from "#/editing-copy.ts";
import { Confirm } from "#/ui/confirm.tsx";
import { TextField } from "#/ui/form.tsx";
import { Button } from "#/ui/shadcn/button.tsx";

export interface CardSummary {
  id: string;
  /** The template's name, or "Cloze N". */
  name: string;
  memory: MemoryState | undefined;
}

/** Forget and Set due date for each card of a note. Both append to the review log. */
export function CardActions({
  cards,
  locale,
  busy,
  onForget,
  onSetDueDate,
}: {
  cards: readonly CardSummary[];
  locale: Locale;
  busy: boolean;
  onForget: (cardId: string) => void;
  onSetDueDate: (cardId: string, days: number) => void;
}) {
  const t = editingCopy(locale);
  return (
    <section aria-labelledby="note-cards" className="flex flex-col gap-4">
      <h3 id="note-cards" className="text-label font-bold">
        {t("cards")}
      </h3>
      {cards.map((card) => (
        <CardRow
          key={card.id}
          card={card}
          locale={locale}
          busy={busy}
          onForget={() => onForget(card.id)}
          onSetDueDate={(n) => onSetDueDate(card.id, n)}
        />
      ))}
    </section>
  );
}

function CardRow({
  card,
  locale,
  busy,
  onForget,
  onSetDueDate,
}: {
  card: CardSummary;
  locale: Locale;
  busy: boolean;
  onForget: () => void;
  onSetDueDate: (days: number) => void;
}) {
  const t = editingCopy(locale);
  const isNew = !card.memory || card.memory.state === CardState.New;
  const state = isNew
    ? t("cardNew")
    : t("cardDue", {
        // react-doctor-disable-next-line react-doctor/no-locale-format-in-render -- The editor renders in the browser only, after the local database opened.
        date: card.memory!.due.toLocaleDateString(locale, { day: "numeric", month: "short" }),
      });
  return (
    <div
      role="group"
      aria-label={card.name}
      className="flex flex-col gap-3 border-b border-border pb-4"
    >
      <p className="text-body">
        <span className="font-bold">{card.name}</span>{" "}
        <span className="text-label text-muted-foreground">{state}</span>
      </p>
      <Confirm
        label={t("forget")}
        question={t("forgetConfirm")}
        confirm={t("forget")}
        cancel={t("cancel")}
        disabled={busy || isNew}
        onConfirm={onForget}
      />
      {isNew ? (
        <p className="text-caption text-muted-foreground">{t("dueNeedsReview")}</p>
      ) : (
        <DueDateForm locale={locale} busy={busy} onSetDueDate={onSetDueDate} />
      )}
    </div>
  );
}

/** Set due date: the days from today, checked as typed. */
function DueDateForm({
  locale,
  busy,
  onSetDueDate,
}: {
  locale: Locale;
  busy: boolean;
  onSetDueDate: (days: number) => void;
}) {
  const t = editingCopy(locale);
  const form = useForm({
    defaultValues: { days: "1" },
    onSubmit: ({ value: { days }, formApi }) => {
      const due = readDueDays(days);
      if (due === undefined) return;
      onSetDueDate(due);
      formApi.reset();
    },
  });
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field
        name="days"
        validators={{
          onChange: ({ value }) =>
            readDueDays(value) === undefined ? t("invalidDays") : undefined,
        }}
      >
        {(field) => (
          <TextField
            label={t("dueDays")}
            errors={field.state.meta.errors}
            className="w-56"
            inputMode="numeric"
            value={field.state.value}
            onChange={field.handleChange}
            onBlur={field.handleBlur}
          />
        )}
      </form.Field>
      <form.Subscribe selector={(s) => s.canSubmit}>
        {(canSubmit) => (
          <Button type="submit" variant="outline" size="lg" disabled={busy || !canSubmit}>
            {t("setDueDate")}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
