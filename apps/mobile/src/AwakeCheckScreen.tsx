import { useQuery } from "@tanstack/react-query";
import { awakeCheckSession, RING_POLICY, type Grade, type Locale } from "@app/core";
import { Effect, type Layer } from "effect";
import { useEffect, useRef } from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { AlarmService, AwakeCheck } from "./alarms.ts";
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

const TIMEOUT_MS = RING_POLICY.awakeCheckSeconds * 1000;

/**
 * The awake check's prompt: one card, any grade passes it. Native owns the timeout and rings the
 * alarm again when it runs out, so this screen only counts down. Always dark, like the alarm.
 */
export function AwakeCheckScreen({
  check,
  locale,
  layer,
  onPassed,
  gradeDelayMs = GRADE_DELAY_MS,
}: {
  check: AwakeCheck;
  locale: Locale;
  layer: Layer.Layer<AlarmService>;
  onPassed: () => void;
  gradeDelayMs?: number;
}) {
  const t = copy(locale);
  const insets = useSafeAreaInsets();
  const now = useClock(1000);
  const prompt = useAwakeCheck(check, layer, onPassed, gradeDelayMs);
  const left = Math.max(0, (check.shownAt ?? now) + TIMEOUT_MS - now);
  const next = prompt.session?.next;
  return (
    <View
      className="flex-1 gap-4 bg-background px-6"
      style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
    >
      <Text className="text-clock text-foreground" style={bold}>
        {new Date(now).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
      </Text>
      <Text className="text-question text-foreground" style={bold}>
        {t("stillAwake")}
      </Text>
      <View className="gap-2">
        <View className="h-[5px] rounded-pill bg-surface">
          <View
            className="h-[5px] rounded-pill bg-attention"
            style={{ width: `${(left / TIMEOUT_MS) * 100}%` }}
          />
        </View>
        <Text className="text-label text-attention">
          {t("awakeCheckLeft", { seconds: String(Math.ceil(left / 1000)) })}
        </Text>
      </View>
      {prompt.error && (
        <Text accessibilityRole="alert" className="text-body text-destructive">
          {t("alarmError")}
        </Text>
      )}
      {next && (
        <AlarmCard
          next={next}
          reveal={prompt.card}
          busy={prompt.busy}
          locale={locale}
          onReveal={prompt.card.reveal}
          onAnswer={prompt.answer}
        />
      )}
      {prompt.session && !next && (
        <>
          <Text className="flex-1 text-body text-muted-foreground">{t("noCards")}</Text>
          <PillButton primary label={t("imAwake")} busy={prompt.busy} onPress={prompt.pass} />
        </>
      )}
    </View>
  );
}

/** The check's card, and its answer: a normal review carrying the check's id, then the pass. */
function useAwakeCheck(
  check: AwakeCheck,
  layer: Layer.Layer<AlarmService>,
  onPassed: () => void,
  gradeDelayMs: number,
) {
  const { busy, error, guarded } = useGuarded();
  const shownAt = useRef(0);
  const signal = signalWith(layer);
  const query = useQuery({
    queryKey: ["awakeCheck", check.id],
    networkMode: "always",
    queryFn: async () => {
      const { collection, log } = await Effect.runPromise(
        localData((data) => Effect.all({ collection: data.collection, log: data.reviewLog })),
      );
      return awakeCheckSession({
        collection,
        log,
        deckId: check.alarm.deckId,
        checkId: check.id,
        now: Date.now(),
      });
    },
  });
  const session = query.data;
  const cardId = session?.next?.card.id;
  const card = useReveal(cardId, gradeDelayMs);
  useBlockBack();
  useEffect(() => {
    // When the card appeared, on the monotonic clock: the answer's time taken.
    if (cardId) shownAt.current = performance.now();
  }, [cardId]);
  const pass = async () => {
    await signal((service) => service.awakeCheckPassed(check.id));
    onPassed();
  };
  const alreadyPassed = session?.passed === true;
  useEffect(() => {
    // Answered before a restart, but native never heard: tell it now.
    if (alreadyPassed) void guarded(pass);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- runs once the log says it passed.
  }, [alreadyPassed]);
  return {
    session,
    busy,
    error: error || query.isError,
    card,
    pass: () => guarded(pass),
    answer: (grade: Grade) =>
      guarded(async () => {
        if (!cardId || !card.revealed) return;
        const durationMs = Math.max(0, performance.now() - shownAt.current);
        await Effect.runPromise(
          localData((data) => data.answerCard(cardId, grade, durationMs, check.id)),
        );
        await pass();
      }),
  };
}
