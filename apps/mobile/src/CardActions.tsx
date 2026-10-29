import { CardState, readDueDays, type Card, type Locale, type MemoryState } from "@app/core";
import { useForm } from "@tanstack/react-form";
import { Alert, Text, View } from "react-native";
import { Button, TextField } from "./controls.tsx";
import { copy } from "./copy.ts";
import { editingCopy } from "./editing-copy.ts";
import { bold, regular } from "./fonts.ts";

/**
 * Forget and Set due date for each card of a note. Both append to the review log. AnkiDroid's API
 * can't write either, so on a linked deck they stay in the app, and the screen says so (ADR 0003).
 */
export function CardActions({
  cards,
  memory,
  locale,
  busy,
  linked = false,
  onForget,
  onSetDueDate,
}: {
  cards: readonly Card[];
  memory: (cardId: string) => MemoryState | undefined;
  locale: Locale;
  busy: boolean;
  linked?: boolean;
  onForget: (cardId: string) => void;
  onSetDueDate: (cardId: string, days: number) => void;
}) {
  return (
    <View className="gap-8">
      {linked && (
        <Text style={regular} className="text-body text-muted-foreground">
          {editingCopy(locale)("linkedOnly")}
        </Text>
      )}
      {cards.map((card) => (
        <CardRow
          key={card.id}
          card={card}
          memory={memory(card.id)}
          locale={locale}
          busy={busy}
          onForget={() => onForget(card.id)}
          onSetDueDate={(n) => onSetDueDate(card.id, n)}
        />
      ))}
    </View>
  );
}

function CardRow({
  card,
  memory,
  locale,
  busy,
  onForget,
  onSetDueDate,
}: {
  card: Card;
  memory: MemoryState | undefined;
  locale: Locale;
  busy: boolean;
  onForget: () => void;
  onSetDueDate: (days: number) => void;
}) {
  const t = editingCopy(locale);
  const common = copy(locale);
  const isNew = !memory || memory.state === CardState.New;
  const form = useForm({
    defaultValues: { days: "1" },
    onSubmit: ({ value, formApi }) => {
      onSetDueDate(readDueDays(value.days)!);
      formApi.reset();
    },
  });
  const title = t("card", { number: String(card.fields.ordinal.value + 1) });
  return (
    <View className="gap-4 border-t border-border pt-6" accessibilityLabel={title}>
      <View className="flex-row flex-wrap justify-between gap-2">
        <Text style={bold} className="text-body text-foreground">
          {title}
        </Text>
        <Text style={regular} className="text-body text-muted-foreground">
          {isNew ? t("cardNew") : t("cardDue", { date: memory.due.toLocaleDateString(locale) })}
        </Text>
      </View>
      <Button
        label={t("forget")}
        disabled={busy || isNew}
        onPress={() =>
          Alert.alert(t("forgetTitle"), t("forgetBody"), [
            { text: common("cancel"), style: "cancel" },
            { text: t("forget"), style: "destructive", onPress: onForget },
          ])
        }
      />
      {isNew ? (
        <Text style={regular} className="text-label text-muted-foreground">
          {t("dueNeedsReview")}
        </Text>
      ) : (
        <>
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
                value={field.state.value}
                onChange={field.handleChange}
                onBlur={field.handleBlur}
                error={field.state.meta.errors[0]}
                numeric
              />
            )}
          </form.Field>
          <form.Subscribe selector={(state) => state.canSubmit}>
            {(canSubmit) => (
              <Button
                label={t("setDueDate")}
                disabled={busy || !canSubmit}
                onPress={() => {
                  void form.handleSubmit();
                }}
              />
            )}
          </form.Subscribe>
        </>
      )}
    </View>
  );
}
