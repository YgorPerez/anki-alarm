import type { Deck, Locale } from "@app/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Effect } from "effect";
import { useRef, useState } from "react";
import { Switch, Text, View } from "react-native";
import { ankiDroidCopy } from "./ankidroid-copy.ts";
import { ankiDroidProvider, AnkiDroidError, type AnkiDroidApi } from "./ankidroid.ts";
import { Button } from "./controls.tsx";
import { localData } from "./database.ts";
import { regular } from "./fonts.ts";

type Translate = ReturnType<typeof ankiDroidCopy>;
type Status = { tone: "busy" | "done" | "error"; text: string };
const reasonCopy = (error: unknown, fallback: "pullError" | "syncBackError") =>
  error instanceof AnkiDroidError && error.reason !== "failed" ? error.reason : fallback;

/**
 * On a linked deck: that it is linked, and on the phone that linked it, pull and sync back on
 * demand plus the auto sync back after alarm sessions. Elsewhere it is a normal deck (ADR 0001).
 */
export function LinkedDeckPanel({
  ankiDroid,
  deck,
  locale,
  disabled,
}: {
  ankiDroid: AnkiDroidApi;
  deck: Deck;
  locale: Locale;
  disabled: boolean;
}) {
  const t = ankiDroidCopy(locale);
  const client = useQueryClient();
  const phone = useQuery({
    queryKey: ["deviceId"],
    queryFn: () => Effect.runPromise(localData((data) => Effect.succeed(data.deviceId))),
  });
  const auto = useQuery({
    queryKey: ["autoSyncBack"],
    queryFn: () => Effect.runPromise(localData((data) => data.autoSyncBack)),
  });
  const [status, setStatus] = useState<Status>();
  const busy = useRef(false);
  const owned = phone.data !== undefined && deck.fields.linkedBy?.value === phone.data;

  async function run(kind: "pull" | "syncBack") {
    if (busy.current) return;
    busy.current = true;
    setStatus({ tone: "busy", text: t(kind === "pull" ? "pulling" : "syncingBack") });
    const provider = ankiDroidProvider(ankiDroid);
    try {
      if (kind === "pull") {
        const pulled = await Effect.runPromise(
          localData((data) => data.pullAnkiDroid(provider, deck.id)),
        );
        setStatus({ tone: "done", text: summary(t, "pulled", pulled) });
      } else {
        const sent = await Effect.runPromise(localData((data) => data.syncBackAnkiDroid(provider)));
        setStatus({ tone: "done", text: summary(t, "sentBack", sent) });
      }
    } catch (error) {
      setStatus({
        tone: "error",
        text: t(reasonCopy(error, kind === "pull" ? "pullError" : "syncBackError")),
      });
    }
    await Promise.all(
      ["collection", "reviewLog", "study"].map((key) =>
        client.invalidateQueries({ queryKey: [key] }),
      ),
    );
    busy.current = false;
  }
  async function setAuto(on: boolean) {
    await Effect.runPromise(localData((data) => data.setAutoSyncBack(on))).catch(() => {});
    await client.invalidateQueries({ queryKey: ["autoSyncBack"] });
  }

  const working = disabled || status?.tone === "busy";
  return (
    <View className="gap-4">
      <Text style={regular} className="text-label text-muted-foreground">
        {t("linkedLabel")}
      </Text>
      {phone.data !== undefined && !owned && (
        <Text style={regular} className="text-body text-muted-foreground">
          {t("otherPhone")}
        </Text>
      )}
      {owned && (
        <>
          <Button label={t("pull")} disabled={working} onPress={() => void run("pull")} />
          <Button label={t("syncBack")} disabled={working} onPress={() => void run("syncBack")} />
          {status && (
            <Text
              accessibilityRole={status.tone === "error" ? "alert" : undefined}
              accessibilityLiveRegion="polite"
              style={regular}
              className={
                status.tone === "error"
                  ? "text-body text-destructive"
                  : status.tone === "busy"
                    ? "text-body text-attention"
                    : "text-body text-foreground"
              }
            >
              {status.text}
            </Text>
          )}
          <Text style={regular} className="text-label text-muted-foreground">
            {t("syncBackNote")}
          </Text>
          <View className="min-h-12 flex-row items-center justify-between gap-4">
            <Text style={regular} className="flex-1 text-body text-foreground">
              {t("auto")}
            </Text>
            <Switch
              accessibilityLabel={t("auto")}
              value={auto.data ?? true}
              disabled={auto.data === undefined}
              onValueChange={(on) => void setAuto(on)}
            />
          </View>
        </>
      )}
    </View>
  );
}

function summary(
  t: Translate,
  key: "pulled" | "sentBack",
  counts: { sent: number; held: number; snapshots: number; added?: number; edited?: number },
) {
  const text = t(key, {
    sent: String(counts.sent),
    snapshots: String(counts.snapshots),
    added: String(counts.added ?? 0),
    edited: String(counts.edited ?? 0),
  });
  return counts.held ? `${text} ${t("held", { held: String(counts.held) })}` : text;
}
