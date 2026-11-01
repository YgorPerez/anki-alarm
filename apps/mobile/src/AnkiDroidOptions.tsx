import {
  ankiDroidScheduler,
  presetFromOptions,
  type Deck,
  type Locale,
  type PresetOptions,
} from "@app/core";
import { useQuery } from "@tanstack/react-query";
import { Effect } from "effect";
import { Text, View } from "react-native";
import type { AnkiDroidApi } from "./ankidroid.ts";
import { localData } from "./database.ts";
import { editingCopy } from "./editing-copy.ts";
import { ankiDroidCopy } from "./ankidroid-copy.ts";
import { Button } from "./controls.tsx";
import { regular } from "./fonts.ts";

/** Reads only: copying stages options in the editor until Save. */
export function AnkiDroidOptions({
  deck,
  api,
  locale,
  busy,
  onBring,
}: {
  deck: Deck;
  api: AnkiDroidApi;
  locale: Locale;
  busy: boolean;
  onBring: (options: Omit<PresetOptions, "name">) => void;
}) {
  const t = editingCopy(locale);
  const phone = useQuery({
    queryKey: ["deviceId"],
    queryFn: () => Effect.runPromise(localData((data) => Effect.succeed(data.deviceId))),
  });
  const owned = phone.data !== undefined && deck.fields.linkedBy?.value === phone.data;
  const source = useQuery({
    queryKey: ["ankiDroidOptions", deck.id],
    enabled: owned,
    retry: false,
    queryFn: () => Effect.runPromise(api.readDeck(deck.anki!.id)),
  });
  const scheduler = source.data ? ankiDroidScheduler(source.data) : "unknown";
  async function bring() {
    const result = await source.refetch();
    const ad = result.data?.decks.find((d) => d.id === deck.anki?.id);
    if (result.isError || !ad) return;
    const { ankiId: _id, name: _name, ...options } = presetFromOptions(ad.options);
    onBring(options);
  }
  return (
    <View className="gap-4">
      <Text style={regular} className="text-body text-muted-foreground">
        {t("ankiDroidOptionsNote")}
      </Text>
      {owned && (
        <>
          {scheduler !== "fsrs" && (
            <Text style={regular} className="text-body text-attention">
              {t(scheduler === "sm2" ? "ankiDroidSm2" : "ankiDroidUnknown")}
            </Text>
          )}
          <Text style={regular} className="text-body text-muted-foreground">
            {t("bringAnkiDroidHint")}
          </Text>
          <Button
            label={t("bringAnkiDroid")}
            disabled={busy || source.isFetching}
            onPress={() => void bring()}
          />
          {source.isError && (
            <Text accessibilityRole="alert" style={regular} className="text-body text-destructive">
              {ankiDroidCopy(locale)("failed")}
            </Text>
          )}
        </>
      )}
    </View>
  );
}
