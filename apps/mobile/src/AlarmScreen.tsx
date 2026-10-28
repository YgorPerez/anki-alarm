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

const GRADE_DELAY_MS = SESSION_RULES.gradeDelaySeconds * 1000;
const bold = { fontFamily: "AtkinsonHyperlegible_700Bold" };
type Session = ReturnType<typeof alarmSession>;

/** The ring's alarm and the alarms folded into it, from the ingested journal. */
const absorbedInto = (ring: Ring, events: readonly AlarmEvent[], alarms: readonly Alarm[]) =>
  events
    .filter((e) => e.kind === "absorbed" && e.ringId === ring.id)
    .flatMap((e) => alarms.filter((a) => a.id === e.alarmId));

/** Runs an operation and reports whether it succeeded. Outside the components: React Compiler
 * doesn't compile `try` with `await`. */
async function succeeded(operation: () => Promise<void>) {
  try {
    await operation();
    return true;
  } catch {
    return false;
  }
}

/**
 * The alarm screen: Start begins the session, and N cards rated Good or Easy dismiss the ring.
 * Always dark: the caller wraps it in the dark ScopedTheme.
 */
export function AlarmScreen({
  ring,
  locale,
  layer,
  onDismissed,
  gradeDelayMs = GRADE_DELAY_MS,
}: {
  ring: Ring;
  locale: Locale;
  layer: Layer.Layer<AlarmService>;
  onDismissed: () => void;
  gradeDelayMs?: number;
}) {
  const t = copy(locale);
  const insets = useSafeAreaInsets();
  const clock = useClock();
  const alarm = useAlarmSession(ring, layer, onDismissed, gradeDelayMs);
  const { session, started, busy } = alarm;
  return (
    <View
      className="flex-1 gap-4 bg-background px-6"
      style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
    >
      <Text className="text-clock text-foreground" style={bold}>
        {new Date(clock).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
      </Text>
      <Text className="text-body text-muted-foreground">{ring.alarm.label}</Text>
      {started && session && <Progress session={session} locale={locale} />}
      {alarm.error && (
        <Text accessibilityRole="alert" className="text-body text-destructive">
          {t("alarmError")}
        </Text>
      )}
      {!started && (
        <>
          <View className="flex-1" />
          <PillButton primary label={t("start")} busy={busy} onPress={alarm.start} />
        </>
      )}
      {started && session?.next && (
        <>
          {session.next.again && (
            <View className="self-start rounded-pill bg-attention-tint px-3 py-1">
              <Text className="text-label text-attention">{t("cameBack")}</Text>
            </View>
          )}
          <WebView
            key={`${session.next.card.id}-${alarm.revealed}`}
            accessibilityLabel={t(alarm.revealed ? "answer" : "front")}
            style={{ flex: 1, backgroundColor: "#000" }}
            source={{
              html: renderCard(
                session.next.note,
                session.next.noteType,
                alarm.revealed ? "back" : "front",
                true,
              ),
            }}
            javaScriptEnabled={false}
            originWhitelist={["about:*"]}
            onShouldStartLoadWithRequest={(request) => request.url === "about:blank"}
          />
          <AnswerControls
            revealed={alarm.revealed}
            gradesShown={alarm.gradesShown}
            busy={busy}
            locale={locale}
            onReveal={alarm.reveal}
            onAnswer={alarm.answer}
          />
        </>
      )}
      {started && session && !session.next && !session.done && (
        <>
          <Text className="flex-1 text-question text-foreground" style={bold}>
            {t("noCards")}
          </Text>
          <PillButton label={t("dismiss")} busy={busy} onPress={alarm.dismiss} />
        </>
      )}
    </View>
  );
}

function Progress({ session, locale }: { session: Session; locale: Locale }) {
  const segments = Array.from({ length: session.need }, (_, index) => ({
    key: `segment-${index}`,
    filled: index < session.right,
  }));
  return (
    <View className="gap-2">
      <View className="flex-row gap-1">
        {segments.map((segment) => (
          <View
            key={segment.key}
            className={`h-[5px] flex-1 rounded-pill ${segment.filled ? "bg-primary" : "bg-surface"}`}
          />
        ))}
      </View>
      <Text className="text-label text-attention">
        {copy(locale)("progress", {
          right: String(session.right),
          need: String(session.need),
          left: String(Math.max(0, session.need - session.right)),
        })}
      </Text>
    </View>
  );
}

function PillButton({
  label,
  busy,
  primary = false,
  onPress,
}: {
  label: string;
  busy: boolean;
  primary?: boolean;
  onPress: () => Promise<void>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={() => {
        void onPress();
      }}
      className={`min-h-16 items-center justify-center rounded-pill ${primary ? "bg-primary" : "bg-surface"}`}
    >
      <Text
        className={`text-body ${primary ? "text-primary-foreground" : "text-foreground"}`}
        style={bold}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** The session's state and the signals it sends native. Progress is the log's answers for this
 * ring, so a restart resumes the count. */
function useAlarmSession(
  ring: Ring,
  layer: Layer.Layer<AlarmService>,
  onDismissed: () => void,
  gradeDelayMs: number,
) {
  const [started, setStarted] = useState(false);
  const [revealedId, setRevealedId] = useState<string>();
  const [gradesFor, setGradesFor] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const lock = useRef(false);
  // When the current card appeared, on the monotonic clock: the answer's time taken.
  const shownAt = useRef(0);
  const signal = (send: (service: AlarmService["Service"]) => Effect.Effect<void, Error>) =>
    Effect.runPromise(Effect.flatMap(AlarmService, send).pipe(Effect.provide(layer)));
  const query = useQuery({
    queryKey: ["alarmSession", ring.id],
    networkMode: "always",
    queryFn: async () => {
      const { collection, log, alarms, events } = await Effect.runPromise(
        localData((data) =>
          Effect.all({
            collection: data.collection,
            log: data.reviewLog,
            alarms: data.alarms,
            events: data.events,
          }),
        ),
      );
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
  const cardId = session?.next?.card.id;
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

  const guarded = async (operation: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(false);
    setError(!(await succeeded(operation)));
    lock.current = false;
    setBusy(false);
  };
  const finish = async () => {
    await signal((service) => service.dismiss(ring.id));
    onDismissed();
  };
  return {
    session,
    started,
    busy,
    error: error || query.isError,
    revealed,
    gradesShown: Boolean(cardId && gradesFor === cardId),
    start: () =>
      guarded(async () => {
        await signal((service) => service.sessionStarted(ring.id));
        setStarted(true);
        shownAt.current = performance.now();
        if (session?.done) await finish();
      }),
    reveal: () => {
      if (!cardId) return;
      setRevealedId(cardId);
      void signal((service) => service.activity(ring.id)).catch(() => setError(true));
    },
    answer: (grade: Grade) =>
      guarded(async () => {
        if (!cardId || !revealed) return;
        await signal((service) => service.activity(ring.id));
        const durationMs = Math.max(0, performance.now() - shownAt.current);
        await Effect.runPromise(
          localData((data) => data.answerCard(cardId, grade, durationMs, ring.id)),
        );
        setRevealedId(undefined);
        const { data } = await query.refetch();
        shownAt.current = performance.now();
        if (data?.done) await finish();
      }),
    dismiss: () => guarded(finish),
  };
}

function useClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
