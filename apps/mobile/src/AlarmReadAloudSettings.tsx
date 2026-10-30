import { COLLECTION_QUERY_KEY } from "./collection-query.ts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { deckLanguage, READ_ALOUD_LANGUAGES, type Alarm, type Locale } from "@app/core";
import { Effect } from "effect";
import { useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { copy } from "./copy.ts";
import { localData } from "./database.ts";

/**
 * The alarm editor's read aloud switch and the language its deck is read in. The language belongs
 * to the deck (its subdecks inherit it), so picking one saves it at once.
 */
export function AlarmReadAloudSettings({
  alarm,
  locale,
  onChange,
}: {
  alarm: Alarm;
  locale: Locale;
  onChange: (alarm: Alarm) => void;
}) {
  const t = copy(locale);
  const client = useQueryClient();
  const [error, setError] = useState(false);
  const collection = useQuery({
    queryKey: COLLECTION_QUERY_KEY,
    networkMode: "always",
    queryFn: () => Effect.runPromise(localData((data) => data.collection)),
  });
  const { deckId } = alarm;
  const deck = collection.data?.decks.find((d) => d.id === deckId);
  const language = deck && collection.data ? deckLanguage(collection.data, deck.id) : null;
  const choose = (tag: string) => {
    if (!deck) return;
    setError(false);
    Effect.runPromise(
      localData((data) => data.changeCollection((c) => c.setDeckLanguage(deck.id, tag))),
    ).then(
      () => client.invalidateQueries({ queryKey: COLLECTION_QUERY_KEY }),
      () => setError(true),
    );
  };
  return (
    <View className="gap-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-body text-foreground">{t("readAloud")}</Text>
        <Switch
          accessibilityLabel={t("readAloud")}
          value={alarm.readAloud}
          onValueChange={(readAloud) => onChange({ ...alarm, readAloud })}
        />
      </View>
      <Text className="text-label text-muted-foreground">{t("readAloudHint")}</Text>
      {alarm.readAloud && (
        <>
          <Text className="text-body font-bold text-foreground">{t("deckLanguage")}</Text>
          {!deckId && (
            <Text className="text-body text-muted-foreground">{t("deckLanguageNeedsDeck")}</Text>
          )}
          {language && (
            <View className="flex-row flex-wrap gap-2">
              {READ_ALOUD_LANGUAGES.map((choice) => (
                <Pressable
                  key={choice.tag}
                  accessibilityRole="radio"
                  accessibilityLabel={choice.name}
                  accessibilityState={{ checked: language === choice.tag }}
                  onPress={() => choose(choice.tag)}
                  className={`min-h-12 justify-center rounded-pill px-4 ${language === choice.tag ? "bg-primary-tint" : "bg-surface"}`}
                >
                  <Text className="text-body text-foreground">{choice.name}</Text>
                </Pressable>
              ))}
            </View>
          )}
          {error && (
            <Text accessibilityRole="alert" className="text-body text-attention">
              {t("alarmError")}
            </Text>
          )}
        </>
      )}
    </View>
  );
}
