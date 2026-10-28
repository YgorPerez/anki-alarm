import { useQuery } from "@tanstack/react-query";
import {
  alarmSession,
  renderCard,
  ringNeed,
  SESSION_RULES,
  type Alarm,
  type Grade,
  type Locale,
} from "@app/core";
import type { AlarmEvent } from "@app/client-data";
import { Effect, type Layer } from "effect";
import { useEffect, useRef, useState } from "react";
import { BackHandler, Pressable, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AlarmService, type Ring } from "./alarms.ts";
import { copy } from "./copy.ts";
import { localData } from "./database.ts";
import { AnswerControls } from "./StudyScreen.tsx";

const bold = { fontFamily: "AtkinsonHyperlegible_700Bold" };

/** The ring's alarm and the alarms folded into it, from the ingested journal. */
const absorbedInto = (ring: Ring, events: readonly AlarmEvent[], alarms: readonly Alarm[]) =>
  events
    .filter((e) => e.kind === "absorbed" && e.ringId === ring.id)
    .flatMap((e) => alarms.filter((a) => a.id === e.alarmId));

/**
 * The alarm screen: Start begins the session, and N cards rated Good or Easy dismiss the ring.
 * Always dark: the caller wraps it in the dark ScopedTheme.
 * Progress is the review log's answers for this ring, so a restart resumes the count.
 */
export function AlarmScreen({
  ring,
  locale,
  layer,
  onDismissed,
  gradeDelayMs = SESSION_RULES.gradeDelaySeconds * 1000,
}: {
  ring: Ring;
  locale: Locale;
  layer: Layer.Layer<AlarmService>;
  onDismissed: () => void;
  gradeDelayMs?: number;
}) {
  const t = copy(locale);
  const insets = useSafeAreaInsets();
  const [started, setStarted] = useState(false);
  const [revealedId, setRevealedId] = useState<string>();
  const [gradesFor, setGradesFor] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const lock = useRef(false);
  // When the current card appeared, on the monotonic clock: the answer's time taken.
  const shownAt = useRef(0);
  const clock = useClock();
  const signal = (send: (service: AlarmService["Service"]) => Effect.Effect<void, Error>) =>
    Effect.runPromise(Effect.flatMap(AlarmService, send).pipe(Effect.provide(layer)));
  const query = useQuery({
    queryKey: ["alarmSession", ring.id],
    networkMode: "always",
    queryFn: async () => {
      const snapshot = await Effect.runPromise(
        localData((data) =>
          Effect.all({
            collection: data.collection,
            log: data.reviewLog,
            alarms: data.alarms,
            events: data.events,
          }),
        ),
      );
      const { collection, log, alarms, events } = snapshot;
      return alarmSession({
        collection,
        log,
        deckId: ring.alarm.deckId,
        need: ringNeed(ring.alarm, absorbedInto(ring, events, alarms)),
        ringId: ring.id,
        now: Date.now(),
      });
    },
  });
  const session = query.data;
  const next = session?.next ?? null;
  const cardId = next?.card.id;
  const revealed = Boolean(cardId && revealedId === cardId);
  useEffect(() => {
    // Back never leaves a ringing alarm.
    const handler = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => handler.remove();
  }, []);
  useEffect(() => {
    if (!revealedId) return undefined;
    const timer = setTimeout(() => setGradesFor(revealedId), gradeDelayMs);
    return () => clearTimeout(timer);
  }, [revealedId, gradeDelayMs]);

  async function guarded(operation: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(false);
    try {
      await operation();
    } catch {
      setError(true);
    }
    lock.current = false;
    setBusy(false);
  }
  const finish = async () => {
    await signal((service) => service.dismiss(ring.id));
    onDismissed();
  };
  const start = () =>
    guarded(async () => {
      await signal((service) => service.sessionStarted(ring.id));
      setStarted(true);
      shownAt.current = performance.now();
      if (session?.done) await finish();
    });
  const reveal = () => {
    if (!cardId) return;
    setRevealedId(cardId);
    void signal((service) => service.activity(ring.id)).catch(() => setError(true));
  };
  const answer = (grade: Grade) =>
    guarded(async () => {
      if (!cardId || !revealed) return;
      await signal((service) => service.activity(ring.id));
      await Effect.runPromise(
        localData((data) =>
          data.answerCard(cardId, grade, Math.max(0, performance.now() - shownAt.current), ring.id),
        ),
      );
      setRevealedId(undefined);
      const { data } = await query.refetch();
      shownAt.current = performance.now();
      if (data?.done) await finish();
    });

  return (
    <View
      className="flex-1 gap-4 bg-background px-6"
      style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
    >
      <Text className="text-clock text-foreground" style={bold}>
        {new Date(clock).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
      </Text>
      <Text className="text-body text-muted-foreground">{ring.alarm.label}</Text>
      {started && session && (
        <View className="gap-2">
          <View className="flex-row gap-1">
            {Array.from({ length: session.need }, (_, index) => (
              <View
                key={index}
                className={`h-[5px] flex-1 rounded-pill ${index < session.right ? "bg-primary" : "bg-surface"}`}
              />
            ))}
          </View>
          <Text className="text-label text-attention">
            {t("progress", {
              right: String(session.right),
              need: String(session.need),
              left: String(Math.max(0, session.need - session.right)),
            })}
          </Text>
        </View>
      )}
      {(error || query.isError) && (
        <Text accessibilityRole="alert" className="text-body text-destructive">
          {t("alarmError")}
        </Text>
      )}
      {!started ? (
        <>
          <View className="flex-1" />
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => {
              void start();
            }}
            className="min-h-16 items-center justify-center rounded-pill bg-primary"
          >
            <Text className="text-body text-primary-foreground" style={bold}>
              {t("start")}
            </Text>
          </Pressable>
        </>
      ) : next ? (
        <>
          {next.again && (
            <View className="self-start rounded-pill bg-attention-tint px-3 py-1">
              <Text className="text-label text-attention">{t("cameBack")}</Text>
            </View>
          )}
          <WebView
            key={`${next.card.id}-${revealed}`}
            accessibilityLabel={t(revealed ? "answer" : "front")}
            style={{ flex: 1, backgroundColor: "#000" }}
            source={{
              html: renderCard(next.note, next.noteType, revealed ? "back" : "front", true),
            }}
            javaScriptEnabled={false}
            originWhitelist={["about:*"]}
            onShouldStartLoadWithRequest={(request) => request.url === "about:blank"}
          />
          <AnswerControls
            revealed={revealed}
            gradesShown={gradesFor === cardId}
            busy={busy}
            locale={locale}
            onReveal={reveal}
            onAnswer={answer}
          />
        </>
      ) : (
        session &&
        !session.done && (
          <>
            <Text className="flex-1 text-question text-foreground" style={bold}>
              {t("noCards")}
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => {
                void guarded(finish);
              }}
              className="min-h-16 items-center justify-center rounded-pill bg-surface"
            >
              <Text className="text-body text-foreground">{t("dismiss")}</Text>
            </Pressable>
          </>
        )
      )}
    </View>
  );
}

function useClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
