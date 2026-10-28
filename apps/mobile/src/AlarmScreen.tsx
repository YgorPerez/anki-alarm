import { useQuery } from "@tanstack/react-query";
import {
  alarmSession,
  ringNeed,
  SESSION_RULES,
  snoozeOffer,
  type Grade,
  type Locale,
} from "@app/core";
import { Effect, type Layer } from "effect";
import { useEffect, useRef, useState } from "react";
import { BackHandler, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AlarmService, type Ring } from "./alarms.ts";
import { copy } from "./copy.ts";
import { localData } from "./database.ts";
import { AnswerControls, CardSide } from "./StudyScreen.tsx";

const GRADE_DELAY_MS = SESSION_RULES.gradeDelaySeconds * 1000;
const bold = { fontFamily: "AtkinsonHyperlegible_700Bold" };
type Session = ReturnType<typeof alarmSession>;

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
      <CardSide
        key={`${next.card.id}-${alarm.revealed}`}
        label={t(alarm.revealed ? "answer" : "front")}
        dark
        input={{
          note: next.note,
          type: next.noteType,
          ordinal: next.card.fields.ordinal.value,
          side: alarm.revealed ? "back" : "front",
          dark: true,
          deckName: next.deckName,
        }}
      />
      <AnswerControls
        revealed={alarm.revealed}
        gradesShown={alarm.gradesShown}
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
  // The ring as a signal just left it, until the caller passes native's next one.
  const [local, setLocal] = useState<{ from: Ring; ring: Ring }>();
  const current = local?.from === ring ? local.ring : ring;
  const offer = snoozeOffer(current.alarm, current.snoozes);
  const lock = useRef(false);
  // When the current card appeared, on the monotonic clock: the answer's time taken.
  const shownAt = useRef(0);
  const signal = <A,>(send: (service: AlarmService["Service"]) => Effect.Effect<A, Error>) =>
    Effect.runPromise(Effect.flatMap(AlarmService, send).pipe(Effect.provide(layer)));
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
    current,
    offer,
    error: error || query.isError,
    revealed,
    gradesShown: Boolean(cardId && gradesFor === cardId),
    // Start, or Answer now on a snoozed ring.
    start: () =>
      guarded(async () => {
        await signal((service) => service.sessionStarted(ring.id));
        setLocal({ from: ring, ring: { ...current, phase: "session", snoozedUntil: null } });
        setStarted(true);
        shownAt.current = performance.now();
        if (session?.done) await finish();
      }),
    snooze: () =>
      guarded(async () => {
        if (!offer) return;
        const next = await signal((service) => service.snooze(ring.id, offer.minutes));
        if (next) setLocal({ from: ring, ring: next });
        setStarted(false);
        setRevealedId(undefined);
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
