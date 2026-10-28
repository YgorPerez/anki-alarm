import { useQuery } from "@tanstack/react-query";
import {
  alarmSession,
  awakeCheckAfter,
  readAloudFor,
  ringNeed,
  snoozeOffer,
  type Grade,
  type Locale,
  type ReadAloud,
} from "@app/core";
import { Effect, type Layer } from "effect";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
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
import { mediaUrl } from "./apkg.ts";
import { copy } from "./copy.ts";
import { localData } from "./database.ts";

type Session = ReturnType<typeof alarmSession>;

type Signal = ReturnType<typeof signalWith>;

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
  const { session, current, offer } = alarm;
  const stage = stageOf(current, alarm.started, session);
  const inSession = stage === "card" || stage === "noCards";
  return (
    <View
      className="flex-1 gap-4 bg-background px-6"
      style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
    >
      <Text className="text-clock text-foreground" style={bold}>
        {clockTime(current.snoozedUntil ?? clock, locale)}
      </Text>
      <Text className="text-body text-muted-foreground">{current.alarm.label}</Text>
      {inSession && session && <Progress session={session} locale={locale} />}
      {alarm.error && (
        <Text accessibilityRole="alert" className="text-body text-destructive">
          {t("alarmError")}
        </Text>
      )}
      <StageBody stage={stage} alarm={alarm} locale={locale} />
      {offer && (inSession || stage === "start") && (
        <SnoozeLink offer={offer} busy={alarm.busy} locale={locale} onPress={alarm.snooze} />
      )}
    </View>
  );
}

const clockTime = (at: number, locale: Locale) =>
  new Date(at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });

type Stage = "snoozed" | "start" | "card" | "noCards" | "done";
function stageOf(ring: Ring, started: boolean, session: Session | undefined): Stage {
  if (ring.phase === "snoozed" && ring.snoozedUntil !== null) return "snoozed";
  if (!started) return "start";
  if (!session || session.done) return "done";
  return session.next ? "card" : "noCards";
}

/** What sits between the header and the snooze link at each stage of the ring. */
function StageBody({
  stage,
  alarm,
  locale,
}: {
  stage: Stage;
  alarm: ReturnType<typeof useAlarmSession>;
  locale: Locale;
}) {
  const t = copy(locale);
  const { session, current, busy } = alarm;
  if (stage === "snoozed")
    return (
      <>
        <Snoozed
          until={clockTime(current.snoozedUntil ?? 0, locale)}
          need={session?.need}
          left={alarm.offer?.left ?? 0}
          locale={locale}
        />
        <PillButton label={t("answerNow")} busy={busy} onPress={alarm.start} />
      </>
    );
  if (stage === "start")
    return (
      <>
        <View className="flex-1" />
        <PillButton primary label={t("start")} busy={busy} onPress={alarm.start} />
      </>
    );
  if (stage === "card" && session?.next)
    return <SessionCard next={session.next} alarm={alarm} locale={locale} />;
  if (stage === "noCards")
    return (
      <>
        <Text className="flex-1 text-question text-foreground" style={bold}>
          {t("noCards")}
        </Text>
        <PillButton label={t("dismiss")} busy={busy} onPress={alarm.dismiss} />
      </>
    );
  return null;
}

/** The session's card, the reveal and the grades. */
function SessionCard({
  next,
  alarm,
  locale,
}: {
  next: NonNullable<Session["next"]>;
  alarm: ReturnType<typeof useAlarmSession>;
  locale: Locale;
}) {
  const t = copy(locale);
  return (
    <>
      {next.again && (
        <View className="self-start rounded-pill bg-attention-tint px-3 py-1">
          <Text className="text-label text-attention">{t("cameBack")}</Text>
        </View>
      )}
      <AlarmCard
        next={next}
        reveal={alarm.card}
        busy={alarm.busy}
        locale={locale}
        onReveal={alarm.reveal}
        onAnswer={alarm.answer}
      />
    </>
  );
}

/** A snoozed ring: when it rings again, with how many cards, and the snoozes left. */
function Snoozed({
  until,
  need,
  left,
  locale,
}: {
  until: string;
  need: number | undefined;
  left: number;
  locale: Locale;
}) {
  const t = copy(locale);
  const snoozesLeft =
    left === 0
      ? t("noSnoozesLeft")
      : left === 1
        ? t("snoozesLeftOne")
        : t("snoozesLeft", { count: String(left) });
  return (
    <View className="flex-1 justify-center gap-3">
      <Text className="text-question text-foreground" style={bold}>
        {t("snoozed")}
      </Text>
      {need !== undefined && (
        <Text className="text-body text-attention">
          {t("snoozedUntil", { time: until, count: String(need) })}
        </Text>
      )}
      <Text className="text-body text-muted-foreground">{snoozesLeft}</Text>
    </View>
  );
}

/** Snooze stands alone: a text link under the bottom controls, its cost in the attention color. */
function SnoozeLink({
  offer,
  busy,
  locale,
  onPress,
}: {
  offer: NonNullable<ReturnType<typeof snoozeOffer>>;
  busy: boolean;
  locale: Locale;
  onPress: () => Promise<void>;
}) {
  const t = copy(locale);
  const length = t("snoozeFor", { minutes: String(offer.minutes) });
  const cost = t("snoozeCost", { count: String(offer.cost) });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${length} · ${cost}`}
      disabled={busy}
      onPress={() => {
        void onPress();
      }}
      className="min-h-12 items-center justify-center"
    >
      <Text className="text-label text-muted-foreground underline">
        {length} ·{" "}
        <Text className="text-attention" style={bold}>
          {cost}
        </Text>
      </Text>
    </Pressable>
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
  // The ring as a signal just left it, until the caller passes native's next one.
  const [local, setLocal] = useState<{ from: Ring; ring: Ring }>();
  const current = local?.from === ring ? local.ring : ring;
  const offer = snoozeOffer(current.alarm, current.snoozes);
  // When the current card appeared, on the monotonic clock: the answer's time taken.
  const shownAt = useRef(0);
  const signal = signalWith(layer);
  // Bumped for each card shown, so a reading still under way knows it's been replaced.
  const readingId = useRef(0);
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
    // Each snooze raises N.
    queryKey: ["alarmSession", ring.id, current.snoozes],
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
        need: ringNeed(current, events, alarms),
        ringId: ring.id,
        now: Date.now(),
      });
    },
  });
  const session = query.data;
  const cardId = session?.next?.card.id;
  const card = useReveal(cardId, gradeDelayMs);
  useBlockBack();
  const readsAloud = ring.alarm.readAloud;
  /** Stops a reading under way, as a snooze or leaving the screen does. */
  const stopReading = () => {
    readingId.current++;
    if (readsAloud) void signal((service) => service.stopReading).catch(() => {});
  };
  useEffect(
    () => () => {
      if (!readsAloud) return;
      // Leaving the screen stops the reading.
      readingId.current++;
      void signalWith(layer)((service) => service.stopReading).catch(() => {});
    },
    [layer, readsAloud],
  );

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
    current,
    offer,
    error: error || query.isError,
    card,
    // Start, or Answer now on a snoozed ring.
    start: () =>
      guarded(async () => {
        await signal((service) => service.sessionStarted(ring.id));
        setLocal({ from: ring, ring: { ...current, phase: "session", snoozedUntil: null } });
        setStarted(true);
        shownAt.current = performance.now();
        // Start can come before the session first loads.
        const loaded = session ?? (await query.refetch()).data;
        if (loaded?.done) await finish();
        else read(loaded?.next);
      }),
    snooze: () =>
      guarded(async () => {
        if (!offer) return;
        stopReading();
        const next = await signal((service) => service.snooze(ring.id, offer.minutes));
        if (next) setLocal({ from: ring, ring: next });
        setStarted(false);
        card.hide();
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
        else read(data?.next);
      }),
    dismiss: () => guarded(() => finish(false)),
  };
}
