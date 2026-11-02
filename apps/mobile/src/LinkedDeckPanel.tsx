import { ANKIDROID_SYNC_QUERY_KEY, useAnkiDroidSyncBackStatus } from "./ankidroid-sync-query.ts";
import { COLLECTION_QUERY_KEY } from "./collection-query.ts";
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
const busyCopy = { pull: "pulling", syncBack: "syncingBack", ankiSync: "ankiSyncing" } as const;
const errorCopy = {
  pull: "pullError",
  syncBack: "syncBackError",
  ankiSync: "ankiSyncError",
} as const;
const reasonCopy = (error: unknown, fallback: (typeof errorCopy)[keyof typeof errorCopy]) =>
  error instanceof AnkiDroidError && error.reason !== "failed" ? error.reason : fallback;

/** The deck's link: who owns it, what waits to go back, and the actions on it. */
function useLinkedDeck(ankiDroid: AnkiDroidApi, deck: Deck, t: Translate) {
  const client = useQueryClient();
  const phone = useQuery({
    queryKey: ["deviceId"],
    queryFn: () => Effect.runPromise(localData((data) => Effect.succeed(data.deviceId))),
  });
  const auto = useQuery({
    queryKey: ["autoSyncBack"],
    queryFn: () => Effect.runPromise(localData((data) => data.autoSyncBack)),
  });
  const syncStatus = useAnkiDroidSyncBackStatus();
  const here = syncStatus.data?.pending.filter((a) => a.deckId === deck.id) ?? [];
  const pending = here.filter((a) => !a.offer);
  const held = pending.filter((a) => a.held).length;
  // One offer covers a linked deck and its subdecks: any of their pages can answer it.
  const offerId =
    here.find((a) => a.offer)?.offer ??
    syncStatus.data?.pending.find((a) => a.offer === deck.id)?.offer;
  const offered = syncStatus.data?.pending.filter((a) => a.offer === offerId).length ?? 0;
  const [status, setStatus] = useState<Status>();
  const busy = useRef(false);
  const owned = phone.data !== undefined && deck.fields.linkedBy?.value === phone.data;

  async function run(kind: "pull" | "syncBack" | "ankiSync") {
    if (busy.current) return;
    busy.current = true;
    setStatus({ tone: "busy", text: t(busyCopy[kind]) });
    const provider = ankiDroidProvider(ankiDroid);
    try {
      if (kind === "pull") {
        const pulled = await Effect.runPromise(
          localData((data) => data.pullAnkiDroid(provider, deck.id)),
        );
        setStatus({ tone: "done", text: summary(t, "pulled", pulled) });
      } else if (kind === "ankiSync") {
        const asked = await Effect.runPromise(
          localData((data) => data.requestAnkiDroidSync(provider)),
        );
        setStatus({
          tone: "done",
          text: asked.requested
            ? `${summary(t, "sentBack", asked)} ${t("ankiSyncAsked")}`
            : t("ankiSyncWait", { minutes: String(Math.ceil(asked.waitMs / 60_000)) }),
        });
      } else {
        const sent = await Effect.runPromise(localData((data) => data.syncBackAnkiDroid(provider)));
        setStatus({ tone: "done", text: summary(t, "sentBack", sent) });
      }
    } catch (error) {
      setStatus({
        tone: "error",
        text: t(reasonCopy(error, errorCopy[kind])),
      });
    }
    await Promise.all(
      [ANKIDROID_SYNC_QUERY_KEY, COLLECTION_QUERY_KEY, ["reviewLog"], ["study"]].map((queryKey) =>
        client.invalidateQueries({ queryKey }),
      ),
    );
    busy.current = false;
  }
  async function decide(send: boolean) {
    if (busy.current || !offerId) return;
    setStatus(undefined);
    try {
      await Effect.runPromise(localData((data) => data.resolveAnkiDroidLinkOffer(offerId, send)));
    } catch {
      setStatus({ tone: "error", text: t("offerError") });
      return;
    }
    if (send) await run("syncBack");
    else await client.invalidateQueries({ queryKey: ANKIDROID_SYNC_QUERY_KEY });
  }
  async function setAuto(on: boolean) {
    await Effect.runPromise(localData((data) => data.setAutoSyncBack(on))).catch(() => {});
    await client.invalidateQueries({ queryKey: ["autoSyncBack"] });
  }

  return {
    owned,
    otherPhone: phone.data !== undefined && !owned,
    auto: auto.data,
    pendingCount: pending.length,
    held,
    offered,
    failure: syncStatus.data?.failure,
    status,
    run,
    decide,
    setAuto,
  };
}

/**
 * On a linked deck: that it is linked, and on the phone that linked it, pull, sync back and Sync
 * AnkiDroid on demand plus the auto sync back after alarm sessions. Elsewhere it is a normal deck
 * (ADR 0001).
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
  const link = useLinkedDeck(ankiDroid, deck, t);
  return (
    <View className="gap-4">
      <Text style={regular} className="text-label text-muted-foreground">
        {t("linkedLabel")}
      </Text>
      {link.otherPhone && (
        <Text style={regular} className="text-body text-muted-foreground">
          {t("otherPhone")}
        </Text>
      )}
      {link.owned && <OwnedLinkControls t={t} link={link} disabled={disabled} />}
    </View>
  );
}

function OwnedLinkControls({
  t,
  link,
  disabled,
}: {
  t: Translate;
  link: ReturnType<typeof useLinkedDeck>;
  disabled: boolean;
}) {
  const { auto, held, offered, pendingCount, run, decide, setAuto, status } = link;
  const working = disabled || status?.tone === "busy";
  return (
    <>
      {offered > 0 && (
        <>
          <Text style={regular} className="text-body text-foreground">
            {t("offer", { count: String(offered) })}
          </Text>
          <Button
            label={t("sendOffer")}
            primary
            disabled={working}
            onPress={() => void decide(true)}
          />
          <Button label={t("declineOffer")} disabled={working} onPress={() => void decide(false)} />
        </>
      )}
      <Text style={regular} className="text-body text-foreground">
        {counted(t, pendingCount, "pending", "pendingOne")}
      </Text>
      {held > 0 && (
        <Text style={regular} className="text-body text-attention">
          {counted(t, held, "held", "heldOne")}
        </Text>
      )}
      {pendingCount > held && (
        <Text style={regular} className="text-body text-muted-foreground">
          {t(link.failure === "notRecorded" ? "notRecorded" : "waiting")}
        </Text>
      )}
      <Button label={t("pull")} disabled={working} onPress={() => void run("pull")} />
      <Button label={t("syncBack")} disabled={working} onPress={() => void run("syncBack")} />
      <Button label={t("ankiSync")} disabled={working} onPress={() => void run("ankiSync")} />
      {status && <LinkStatus status={status} />}
      <Text style={regular} className="text-label text-muted-foreground">
        {t("syncBackNote")}
      </Text>
      <Text style={regular} className="text-label text-muted-foreground">
        {t("autoDetails")}
      </Text>
      <View className="min-h-12 flex-row items-center justify-between gap-4">
        <Text style={regular} className="flex-1 text-body text-foreground">
          {t("auto")}
        </Text>
        <Switch
          accessibilityLabel={t("auto")}
          value={auto ?? true}
          disabled={auto === undefined}
          onValueChange={(on) => void setAuto(on)}
        />
      </View>
    </>
  );
}

function LinkStatus({ status }: { status: Status }) {
  return (
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
  );
}

type CountKeys =
  | ["held", "heldOne"]
  | ["pending", "pendingOne"]
  | ["sentBack", "sentBackOne"]
  | ["pulledNotes", "pulledNotesOne"]
  | ["pulledEdited", "pulledEditedOne"]
  | ["pulledCards", "pulledCardsOne"]
  | ["pulledSent", "pulledSentOne"];
function counted(t: Translate, count: number, ...[many, one]: CountKeys) {
  return t(count === 1 ? one : many, { count: String(count) });
}

function summary(
  t: Translate,
  key: "pulled" | "sentBack",
  counts: { sent: number; held: number; snapshots: number; added?: number; edited?: number },
) {
  const text =
    key === "sentBack"
      ? counted(t, counts.sent, "sentBack", "sentBackOne")
      : t("pulled", {
          added: counted(t, counts.added ?? 0, "pulledNotes", "pulledNotesOne"),
          edited: counted(t, counts.edited ?? 0, "pulledEdited", "pulledEditedOne"),
          snapshots: counted(t, counts.snapshots, "pulledCards", "pulledCardsOne"),
          sent: counted(t, counts.sent, "pulledSent", "pulledSentOne"),
        });
  return counts.held ? `${text} ${counted(t, counts.held, "held", "heldOne")}` : text;
}
