import { StudyMenu } from "./StudyMenu.tsx";
import { annotationItems, StudyAnnotations } from "./StudyAnnotations.tsx";
import { useStudyAnnotationChange } from "./study-annotations.ts";
import { StudyNoteEditor } from "./StudyNoteEditor.tsx";
import { useQuery } from "@tanstack/react-query";
import { awakeCheckSession, RING_POLICY, type Grade, type Locale } from "@app/core";
import { Effect, type Layer } from "effect";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { AlarmService, AwakeCheck } from "./alarms.ts";
import {
  AlarmCard,
  AlarmFrame,
  PillButton,
  useBlockBack,
  useGuarded,
  useReveal,
} from "./alarm-ui.tsx";
import { GRADE_DELAY_MS, signalWith } from "./alarm-screen.ts";
import { bold, regular } from "./fonts.ts";
import { Clock, useNow } from "./clock.tsx";
import { timeText } from "./alarm-text.ts";
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
  zone,
  use24Hour,
  layer,
  onPassed,
  gradeDelayMs = GRADE_DELAY_MS,
}: {
  check: AwakeCheck;
  locale: Locale;
  /** The phone's IANA zone and the system's 12 or 24 h setting, as on Home's clock. */
  zone: string;
  use24Hour: boolean;
  layer: Layer.Layer<AlarmService>;
  onPassed: () => void;
  gradeDelayMs?: number;
}) {
  const t = copy(locale);
  const now = useNow();
  const prompt = useAwakeCheck(check, layer, onPassed, gradeDelayMs);
  const left = Math.max(0, (check.shownAt ?? now) + TIMEOUT_MS - now);
  const next = prompt.session?.next;
  // The card whose note is open in the editor, over the card: Back returns to the card.
  const [editing, setEditing] = useState<string>();
  if (next && editing)
    return (
      <AlarmFrame studying top={null}>
        <StudyNoteEditor
          cardId={editing}
          locale={locale}
          onSaved={prompt.refetch}
          onClose={() => setEditing(undefined)}
        />
      </AlarmFrame>
    );
  const top = (
    <>
      <Clock at={now} locale={locale} zone={zone} use24Hour={use24Hour} />
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
        <Text className="text-label text-attention" style={regular}>
          {t("awakeCheckLeft", { seconds: String(Math.ceil(left / 1000)) })}
        </Text>
      </View>
      {prompt.error && (
        <Text accessibilityRole="alert" className="text-body text-destructive" style={regular}>
          {t("alarmError")}
        </Text>
      )}
      {prompt.session && !next && (
        <Text className="text-body text-muted-foreground" style={regular}>
          {t("noCards")}
        </Text>
      )}
    </>
  );
  return (
    <AlarmFrame
      studying={Boolean(next)}
      top={
        next ? (
          <View className="min-h-12 flex-row items-center justify-between px-4">
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.5}
              className="shrink text-body text-attention"
              style={regular}
            >
              {timeText(now, locale, zone, use24Hour)} ·{" "}
              {t("awakeCardProgress", { seconds: String(Math.ceil(left / 1000)) })}
            </Text>
            <StudyAnnotations next={next} locale={locale} />
            <StudyMenu
              items={[
                { id: "editNote", label: t("editNote"), onPress: () => setEditing(next.card.id) },
                ...annotationItems(next, locale, prompt.change),
              ]}
              locale={locale}
              busy={prompt.busy}
            />
            {prompt.error && <Text accessibilityRole="alert">{t("alarmError")}</Text>}
          </View>
        ) : (
          top
        )
      }
    >
      {next ? (
        <AlarmCard
          next={next}
          reveal={prompt.card}
          busy={prompt.busy}
          locale={locale}
          onReveal={prompt.card.reveal}
          onAnswer={prompt.answer}
        />
      ) : (
        <View className="flex-1" />
      )}
      {prompt.session && !next && (
        <PillButton primary label={t("imAwake")} busy={prompt.busy} onPress={prompt.pass} />
      )}
    </AlarmFrame>
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
  const change = useStudyAnnotationChange(guarded, () => query.refetch());
  return {
    session,
    busy,
    error: error || query.isError,
    card,
    pass: () => guarded(pass),
    refetch: () => query.refetch(),
    change,
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
