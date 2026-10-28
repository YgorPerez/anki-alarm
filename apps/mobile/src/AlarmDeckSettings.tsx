import { useQuery } from "@tanstack/react-query";
import { MAX_NEED, type Alarm, type Locale } from "@app/core";
import { Effect } from "effect";
import { Pressable, Text, View } from "react-native";
import { copy } from "./copy.ts";
import { Stepper } from "./controls.tsx";
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
    .toSorted((a, b) => a.name.localeCompare(b.name, locale));
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
      <Stepper
        label={t("need")}
        value={alarm.need}
        text={t("needCount", { count: String(alarm.need) })}
        min={1}
        max={MAX_NEED}
        fewer={t("fewer")}
        more={t("more")}
        onChange={(need) => onChange({ ...alarm, need })}
      />
    </View>
  );
}
