import { useQuery } from "@tanstack/react-query";
import {
  alarmSession,
  awakeCheckAfter,
  ringNeed,
  type Alarm,
  type Grade,
  type Locale,
} from "@app/core";
import type { AlarmEvent } from "@app/client-data";
import { Effect, type Layer } from "effect";
import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { AlarmService, Ring } from "./alarms.ts";
import {
  AlarmCard,
  PillButton,
  useBlockBack,
  useClock,
  useGuarded,
  useReveal,
} from "./alarm-ui.tsx";
import { bold, GRADE_DELAY_MS, signalWith } from "./alarm-screen.ts";
import { copy } from "./copy.ts";
import { localData } from "./database.ts";

type Session = ReturnType<typeof alarmSession>;

/** The ring's alarm and the alarms folded into it, from the ingested journal. */
const absorbedInto = (ring: Ring, events: readonly AlarmEvent[], alarms: readonly Alarm[]) =>
  events
    .filter((e) => e.kind === "absorbed" && e.ringId === ring.id)
    .flatMap((e) => alarms.filter((a) => a.id === e.alarmId));

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
          <AlarmCard
            next={session.next}
            reveal={alarm.card}
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

/** The session's state and the signals it sends native. Progress is the log's answers for this
 * ring, so a restart resumes the count. */
function useAlarmSession(
  ring: Ring,
  layer: Layer.Layer<AlarmService>,
  onDismissed: () => void,
  gradeDelayMs: number,
) {
  const [started, setStarted] = useState(false);
  const { busy, error, setError, guarded } = useGuarded();
  // When the current card appeared, on the monotonic clock: the answer's time taken.
  const shownAt = useRef(0);
  const signal = signalWith(layer);
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
  const card = useReveal(cardId, gradeDelayMs);
  useBlockBack();

  /** A deck with no cards can't give the awake check a card, so that dismissal skips it. */
  const finish = async (awakeCheck = true) => {
    const after = awakeCheck ? awakeCheckAfter(ring.alarm) : null;
    await signal((service) => service.dismiss(ring.id, after));
    onDismissed();
  };
  return {
    session,
    started,
    busy,
    error: error || query.isError,
    card,
    start: () =>
      guarded(async () => {
        await signal((service) => service.sessionStarted(ring.id));
        setStarted(true);
        shownAt.current = performance.now();
        if (session?.done) await finish();
      }),
    reveal: () => {
      if (!cardId) return;
      card.reveal();
      void signal((service) => service.activity(ring.id)).catch(() => setError(true));
    },
    answer: (grade: Grade) =>
      guarded(async () => {
        if (!cardId || !card.revealed) return;
        await signal((service) => service.activity(ring.id));
        const durationMs = Math.max(0, performance.now() - shownAt.current);
        await Effect.runPromise(
          localData((data) => data.answerCard(cardId, grade, durationMs, ring.id)),
        );
        card.hide();
        const { data } = await query.refetch();
        shownAt.current = performance.now();
        if (data?.done) await finish();
      }),
    dismiss: () => guarded(() => finish(false)),
  };
}
