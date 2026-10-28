import { useQuery } from "@tanstack/react-query";
import {
  alarmSession,
  readAloudFor,
  ringNeed,
  SESSION_RULES,
  type Alarm,
  type Grade,
  type Locale,
  type ReadAloud,
} from "@app/core";
import type { AlarmEvent } from "@app/client-data";
import { Effect, type Layer } from "effect";
import { useEffect, useRef, useState } from "react";
import { BackHandler, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AlarmService, type Ring } from "./alarms.ts";
import { mediaUrl } from "./apkg.ts";
import { copy } from "./copy.ts";
import { localData } from "./database.ts";
import { AnswerControls, CardSide } from "./StudyScreen.tsx";

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

type Signal = <A>(
  send: (service: AlarmService["Service"]) => Effect.Effect<A, Error>,
) => Promise<A>;

/**
 * Reads a front: its own clips one after another, as Anki plays them, then TTS when none played.
 * Gives up once not `current`.
 */
async function readFront(
  signal: Signal,
  reading: ReadAloud,
  current: () => boolean,
  from = 0,
  played = false,
): Promise<void> {
  if (!current()) return;
  const clip = reading.clips[from];
  if (clip !== undefined) {
    const ok = await signal((service) => service.playClip(mediaUrl(clip)));
    return readFront(signal, reading, current, from + 1, played || ok);
  }
  if (played || !reading.text) return;
  await signal((service) => service.speak(reading.text, reading.language));
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
          <CardSide
            key={`${session.next.card.id}-${alarm.revealed}`}
            label={t(alarm.revealed ? "answer" : "front")}
            dark
            input={{
              note: session.next.note,
              type: session.next.noteType,
              ordinal: session.next.card.fields.ordinal.value,
              side: alarm.revealed ? "back" : "front",
              dark: true,
              deckName: session.next.deckName,
            }}
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
  // Bumped for each card shown, so a reading still under way knows it's been replaced.
  const readingId = useRef(0);
  const signal: Signal = (send) =>
    Effect.runPromise(Effect.flatMap(AlarmService, send).pipe(Effect.provide(layer)));
  /** Read aloud, when the alarm has it: the card just shown. A failure never blocks the session. */
  const read = (next: Session["next"] | undefined) => {
    const id = ++readingId.current;
    if (!ring.alarm.readAloud || !next) return;
    const reading = readAloudFor({
      note: next.note,
      type: next.noteType,
      ordinal: next.card.fields.ordinal.value,
      deckName: next.deckName,
      language: next.language,
    });
    if (reading) void readFront(signal, reading, () => id === readingId.current).catch(() => {});
  };
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
  const readsAloud = ring.alarm.readAloud;
  useEffect(
    () => () => {
      if (!readsAloud) return;
      // Leaving the screen stops the reading.
      readingId.current++;
      void Effect.runPromise(
        Effect.flatMap(AlarmService, (service) => service.stopReading).pipe(Effect.provide(layer)),
      ).catch(() => {});
    },
    [layer, readsAloud],
  );
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
        // Start can come before the session first loads.
        const current = session ?? (await query.refetch()).data;
        if (current?.done) await finish();
        else read(current?.next);
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
        else read(data?.next);
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
