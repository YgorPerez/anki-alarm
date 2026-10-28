import { useQuery } from "@tanstack/react-query";
import { MAX_NEED, type Alarm, type Locale } from "@app/core";
import { Effect } from "effect";
import { Pressable, Text, View } from "react-native";
import { copy } from "./copy.ts";
import { localData } from "./database.ts";

/** The alarm editor's deck (subdecks ring with their parent) and N. */
export function AlarmDeckSettings({
  alarm,
  locale,
  onChange,
}: {
  alarm: Alarm;
  locale: Locale;
  onChange: (alarm: Alarm) => void;
}) {
  const t = copy(locale);
  const collection = useQuery({
    queryKey: ["collection"],
    networkMode: "always",
    queryFn: () => Effect.runPromise(localData((data) => data.collection)),
  });
  const decks = (collection.data?.decks ?? [])
    .map((deck) => ({ id: deck.id, name: deck.fields.name.value }))
    // Hermes has no toSorted; the array is freshly mapped.
    // oxlint-disable-next-line unicorn/no-array-sort
    .sort((a, b) => a.name.localeCompare(b.name, locale));
  const step = (delta: number) =>
    onChange({ ...alarm, need: Math.min(MAX_NEED, Math.max(1, alarm.need + delta)) });
  return (
    <View className="gap-4">
      <Text className="text-body font-bold text-foreground">{t("alarmDeck")}</Text>
      {collection.isSuccess && decks.length === 0 && (
        <Text className="text-body text-muted-foreground">{t("noDecks")}</Text>
      )}
      {decks.map((deck) => {
        const selected = deck.id === alarm.deckId;
        const path = deck.name.split("::");
        return (
          <Pressable
            key={deck.id}
            accessibilityRole="radio"
            accessibilityLabel={deck.name}
            accessibilityState={{ checked: selected }}
            onPress={() => onChange({ ...alarm, deckId: deck.id })}
            className={`min-h-12 justify-center rounded-pill px-4 ${selected ? "bg-primary-tint" : "bg-surface"}`}
            style={{ marginLeft: (path.length - 1) * 20 }}
          >
            <Text className="text-body text-foreground">{path.at(-1)}</Text>
          </Pressable>
        );
      })}
      <Text className="text-body font-bold text-foreground">{t("need")}</Text>
      <View className="flex-row items-center gap-4">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("fewer")}
          disabled={alarm.need <= 1}
          onPress={() => step(-1)}
          className="min-h-12 min-w-12 items-center justify-center rounded-pill bg-surface"
        >
          <Text className="text-title text-foreground">−</Text>
        </Pressable>
        <Text className="text-body text-foreground">
          {t("needCount", { count: String(alarm.need) })}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("more")}
          disabled={alarm.need >= MAX_NEED}
          onPress={() => step(1)}
          className="min-h-12 min-w-12 items-center justify-center rounded-pill bg-surface"
        >
          <Text className="text-title text-foreground">+</Text>
        </Pressable>
      </View>
    </View>
  );
}
