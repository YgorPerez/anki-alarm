import { deckPreset } from "@app/core";
import { StudyAudio } from "./StudyAudio.tsx";
import { useStudyTimer } from "./use-study-timer.ts";
import { autoSyncBack } from "./ankidroid-sync-query.ts";
import type { AnkiDroidApi } from "./ankidroid.ts";
import { COLLECTION_QUERY_KEY } from "./collection-query.ts";
import { intervalText } from "./interval-text.ts";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import Undo2 from "lucide-react-native/icons/undo-2";
import { ThemedIcon } from "./icons.tsx";
import { StudyMenu } from "./StudyMenu.tsx";
import { StudyAnnotations } from "./StudyAnnotations.tsx";
import { studyMenuItems, takeStudyAction, useStudyChange } from "./study-menu.ts";
import { useUndoStack } from "./study-undo.ts";
import { StudyCounts } from "./StudyCounts.tsx";
import { StudyNoteEditor } from "./StudyNoteEditor.tsx";
import { useContext, type ReactNode } from "react";
import { ScreenActivity } from "./screen-activity.ts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  answerUndo,
  renderCard,
  usesScripts,
  nextStudyCard,
  nextIntervals,
  studyCounts,
  type Grade,
  type Locale,
  type RenderInput,
  type StudyAction,
} from "@app/core";
import { Effect } from "effect";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BackHandler,
  type GestureResponderEvent,
  Pressable,
  Text,
  View,
  useColorScheme,
  useWindowDimensions,
} from "react-native";
import { WebView } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { localData } from "./database.ts";
import { copy } from "./copy.ts";
import { bold } from "./fonts.ts";
import { editingCopy } from "./editing-copy.ts";
import { mediaBaseUrl, mediaUrl } from "./media.ts";

export function StudyScreen({
  deckId,
  locale,
  onExit,
  ankiDroid,
}: {
  ankiDroid?: AnkiDroidApi;
  deckId: string;
  locale: Locale;
  onExit: () => void;
}) {
  const t = copy(locale);
  const insets = useSafeAreaInsets();
  const dark = useColorScheme() === "dark";
  const study = useStudySession(deckId, onExit);
  const { query, busy, error, canUndo, undo } = study;
  const client = useQueryClient();
  const completed = Boolean(query.data && !study.card && !busy);
  const completedSync = useRef(false);
  useEffect(() => {
    if (!completed) {
      completedSync.current = false;
      return;
    }
    if (ankiDroid && !completedSync.current) {
      completedSync.current = true;
      void autoSyncBack(ankiDroid, client);
    }
  }, [ankiDroid, client, completed]);
  // Includes Android Back and a navigator gesture, even when cards remain.
  useEffect(
    () => () => {
      if (ankiDroid) void autoSyncBack(ankiDroid, client);
    },
    [ankiDroid, client],
  );
  const [editing, setEditing] = useState<string>();
  const deckName = query.data?.collection.decks.find((d) => d.id === deckId)?.fields.name.value;
  const frame = { paddingTop: insets.top, paddingBottom: insets.bottom };
  if (editing)
    return (
      <View className="flex-1 bg-background" style={frame}>
        <StudyNoteEditor
          cardId={editing}
          locale={locale}
          onSaved={study.refresh}
          onClose={() => setEditing(undefined)}
        />
      </View>
    );
  return (
    <View className="flex-1 bg-background" style={frame}>
      <StudyNavigation
        annotations={<StudyAnnotations next={study.next} locale={locale} />}
        counts={study.counts}
        items={studyMenuItems({
          next: study.next,
          locale,
          edit: setEditing,
          leave: study.leave,
          change: study.change,
        })}
        title={deckName ?? t("study")}
        busy={busy}
        locale={locale}
        onExit={onExit}
        onUndo={canUndo ? undo : undefined}
      />
      <StudyFeedback
        locale={locale}
        error={error || query.isError}
        retry={
          query.isError
            ? () => {
                void query.refetch();
              }
            : undefined
        }
      />
      <StudyReview study={study} locale={locale} dark={dark} deckName={deckName} />
    </View>
  );
}
function StudyReview({
  study,
  locale,
  dark,
  deckName,
}: {
  study: ReturnType<typeof useStudySession>;
  locale: Locale;
  dark: boolean;
  deckName: string | undefined;
}) {
  const t = copy(locale);
  const { query, card, note, type, busy, revealed, reveal, answer } = study;
  return (
    <>
      {card && note && type ? (
        <>
          <CardSide
            key={`${card.id}-${revealed}-${dark}`}
            label={t(revealed ? "answer" : "front")}
            dark={dark}
            revealHint={!revealed && !busy ? t("revealHint") : undefined}
            onReveal={reveal}
            scripts
            input={{
              note,
              type,
              ordinal: card.fields.ordinal.value,
              side: revealed ? "back" : "front",
              dark,
              ...(deckName === undefined ? {} : { deckName }),
            }}
          />
          {study.timer.show && (
            <Text
              accessibilityLabel={editingCopy(locale)("answerTimer")}
              className="text-label text-muted-foreground"
            >
              {study.timer.seconds}s
            </Text>
          )}
          {study.preset && (
            <StudyAudio
              key={`${card.id}-${revealed}`}
              input={{ note, type, ordinal: card.fields.ordinal.value }}
              side={revealed ? "back" : "front"}
              preset={study.preset}
              locale={locale}
            />
          )}
          <AnswerControls
            intervals={study.intervals}
            onReveal={reveal}
            gradeHeight={56}
            revealed={revealed}
            busy={busy}
            locale={locale}
            onAnswer={answer}
          />
        </>
      ) : (
        <Text className="text-body text-attention">
          {t(query.isPending ? "loading" : "studyDone")}
        </Text>
      )}
    </>
  );
}

function StudyFeedback({
  locale,
  error,
  retry,
}: {
  locale: Locale;
  error: boolean;
  retry: (() => void) | undefined;
}) {
  const t = copy(locale);
  return (
    <>
      {error && (
        <Text accessibilityRole="alert" className="text-body text-destructive">
          {t("error")}
        </Text>
      )}
      {retry && (
        <Pressable accessibilityRole="button" onPress={retry}>
          <Text>{t("retry")}</Text>
        </Pressable>
      )}
    </>
  );
}

function StudyNavigation({
  annotations,
  counts,
  items,
  title,
  busy,
  locale,
  onExit,
  onUndo,
}: {
  annotations: ReactNode;
  counts: ReturnType<typeof studyCounts> | undefined;
  items: Parameters<typeof StudyMenu>[0]["items"];
  title: string;
  busy: boolean;
  locale: Locale;
  onExit: () => void;
  onUndo: (() => Promise<void>) | undefined;
}) {
  return (
    <View className="flex-row items-center justify-between px-4">
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={onExit}
        className="min-h-12 shrink flex-row items-center gap-1"
      >
        <ThemedIcon icon={ChevronLeft} />
        <Text numberOfLines={1} className="shrink text-body text-foreground">
          {title}
        </Text>
      </Pressable>
      {counts && <StudyCounts counts={counts} locale={locale} />}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={editingCopy(locale)("undo")}
        disabled={busy || !onUndo}
        onPress={() => {
          void onUndo?.();
        }}
        className="min-h-12 min-w-12 items-center justify-center px-2"
      >
        <ThemedIcon icon={Undo2} />
      </Pressable>
      {annotations}
      <StudyMenu items={items} locale={locale} busy={busy} />
    </View>
  );
}
/**
 * A card side in a WebView. Card media load from local files only. With `scripts`, a card that has
 * code runs it, with no network, and a tap belongs to the card: its reveal is the Show answer bar.
 */
export function CardSide({
  label,
  dark,
  input,
  revealHint: hint,
  onReveal,
  scripts = false,
}: {
  label: string;
  dark: boolean;
  input: RenderInput;
  revealHint?: string | undefined;
  onReveal: () => void;
  scripts?: boolean;
}) {
  const baseUrl = mediaBaseUrl();
  const html = renderCard({ ...input, media: mediaUrl, scripts });
  const interactive = scripts && usesScripts(html);
  const revealHint = interactive ? undefined : hint;
  // A new source reloads the page, which would wipe what the card's script has marked.
  const source = useMemo(() => ({ html, baseUrl }), [html, baseUrl]);
  const { fontScale } = useWindowDimensions();
  const touch = useRef<{ x: number; y: number; at: number } | undefined>(undefined);
  const move = ({ nativeEvent: e }: GestureResponderEvent) => {
    const start = touch.current;
    if (start && (Math.hypot(e.pageX - start.x, e.pageY - start.y) > 10 || e.touches.length > 1))
      touch.current = undefined;
  };
  return (
    <View
      style={{ flex: 1 }}
      onTouchStart={({ nativeEvent: e }) => {
        touch.current =
          e.touches.length === 1 ? { x: e.pageX, y: e.pageY, at: Date.now() } : undefined;
      }}
      onTouchMove={move}
      onTouchCancel={() => {
        touch.current = undefined;
      }}
      onTouchEnd={(event) => {
        move(event);
        const start = touch.current;
        touch.current = undefined;
        if (start && Date.now() - start.at < 500 && revealHint) onReveal();
      }}
    >
      <WebView
        accessible={!interactive}
        accessibilityLabel={label}
        accessibilityHint={revealHint}
        accessibilityActions={revealHint ? [{ name: "activate", label: revealHint }] : []}
        onAccessibilityAction={({ nativeEvent }) => {
          if (nativeEvent.actionName === "activate" && revealHint) onReveal();
        }}
        style={{ flex: 1, backgroundColor: dark ? "#000" : "#fff" }}
        source={source}
        textZoom={Math.round(100 * fontScale)}
        javaScriptEnabled={interactive}
        setSupportMultipleWindows={false}
        allowFileAccess
        originWhitelist={["about:*", "file://*"]}
        onShouldStartLoadWithRequest={(request) =>
          request.url === "about:blank" || request.url === baseUrl
        }
      />
    </View>
  );
}
const gradeLabels = { 1: "again", 2: "hard", 3: "good", 4: "easy" } as const;
const gradeClasses = { 1: "bg-again-tint", 2: "bg-hard-tint", 3: "bg-good", 4: "bg-easy-tint" };
const gradeText = { 1: "text-again", 2: "text-hard", 3: "text-good-foreground", 4: "text-easy" };

/** Show answer, then the four grades. The alarm keeps the grades back for a moment. */
export function AnswerControls({
  revealed,
  gradesShown = true,
  gradeHeight = 64,
  intervals,
  onReveal,
  busy,
  locale,
  onAnswer,
}: {
  revealed: boolean;
  gradesShown?: boolean;
  gradeHeight?: 56 | 64;
  intervals?: Record<Grade, number> | undefined;
  onReveal?: () => void;
  busy: boolean;
  locale: Locale;
  onAnswer: (grade: Grade) => Promise<void>;
}) {
  const t = copy(locale);
  const dimensions = useWindowDimensions();
  const rows = gradeRows(dimensions);
  const rowHeight = Math.max(gradeHeight, 42 * dimensions.fontScale + 8);
  // 12 above and below, so the pills clear the card and the bottom of the screen.
  const height = rows.length * rowHeight + (rows.length - 1) * 12 + 2 * 12;
  if (!revealed || !gradesShown)
    return (
      <View style={{ height }} className="items-center justify-center">
        {!revealed && onReveal ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={onReveal}
            style={{ height: gradeHeight, alignSelf: "stretch" }}
            className="items-center justify-center bg-surface"
          >
            <Text className="text-body text-foreground">{t("reveal")}</Text>
          </Pressable>
        ) : (
          !revealed && (
            <Text accessibilityLiveRegion="polite" className="text-label text-muted-foreground">
              {t("revealHint")}
            </Text>
          )
        )}
      </View>
    );
  return (
    <View style={{ height }} className="gap-3 px-4 py-3">
      {rows.map((row) => (
        <View key={row.join()} className="flex-row gap-3">
          {row.map((grade) => (
            <Pressable
              key={grade}
              accessibilityRole="button"
              accessibilityLabel={t(gradeLabels[grade])}
              accessibilityHint={intervals ? intervalText(intervals[grade], locale) : undefined}
              disabled={busy}
              onPress={() => {
                void onAnswer(grade);
              }}
              style={{ height: rowHeight }}
              className={`flex-1 items-center justify-center rounded-pill px-1 ${gradeClasses[grade]}`}
            >
              {intervals && (
                <Text className={`text-caption ${gradeText[grade]}`}>
                  {intervalText(intervals[grade], locale)}
                </Text>
              )}
              <Text className={`text-body ${gradeText[grade]}`} style={bold}>
                {t(gradeLabels[grade])}
              </Text>
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

/**
 * One row of four while each pill still holds the longest grade word ("Difícil", about four ems
 * of Body) at the system's font scale; two by two otherwise, so no word breaks mid-letter.
 */
function gradeRows({ width, fontScale }: { width: number; fontScale: number }) {
  const pill = (width - 2 * 16 - 3 * 12) / 4;
  return pill >= 4 * 17 * fontScale ? [[1, 2, 3, 4] as const] : [[1, 2] as const, [3, 4] as const];
}

function useStudySession(deckId: string, onExit: () => void) {
  const client = useQueryClient();
  const [revealedId, setRevealedId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  /** This session's answers and card-menu actions, newest last: what Undo reverses. */
  const history = useUndoStack();
  const [undone, setUndone] = useState<string>();
  const lock = useRef(false);
  const query = useQuery({
    queryKey: ["study", deckId],
    networkMode: "always",
    queryFn: async () => {
      const snapshot = await Effect.runPromise(
        localData((data) => Effect.all({ collection: data.collection, log: data.reviewLog })),
      );
      const now = Date.now();
      return { ...snapshot, now, started: performance.now() };
    },
  });
  const next =
    query.data &&
    nextStudyCard(query.data.collection, query.data.log, deckId, query.data.now, undone);
  const card = next?.card;
  const cardId = card?.id;
  const revealed = Boolean(cardId && revealedId === cardId);
  const ownDeck = query.data?.collection.decks.find((d) => d.id === card?.fields.deckId.value);
  const preset = ownDeck && query.data ? deckPreset(query.data.collection, ownDeck) : undefined;
  const timer = useStudyTimer(query.data?.started, preset);
  const screenActive = useContext(ScreenActivity);
  useEffect(() => {
    if (!screenActive) return undefined;
    const handler = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!lock.current) onExit();
      return true;
    });
    return () => handler.remove();
  }, [onExit, screenActive]);
  async function refresh() {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["study", deckId] }),
      client.invalidateQueries({ queryKey: ["reviewLog"] }),
    ]);
  }
  /** Runs one study operation at a time; a failure shows the error and keeps the card. */
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
  /** Flag or mark: the card stays, revealed or not. */
  const change = useStudyChange(guarded, refresh, history.record);
  async function answer(grade: Grade) {
    if (!cardId || !revealed) return;
    await guarded(async () => {
      const entry = await Effect.runPromise(
        localData((data) => data.answerCard(cardId, grade, timer.duration())),
      );
      history.record(answerUndo(entry));
      setUndone(undefined);
      setRevealedId(undefined);
      await refresh();
    });
  }
  /** Takes the current card out without an answer (suspend, bury); the next one comes. */
  async function leave(action: StudyAction) {
    if (!card) return;
    await guarded(async () => {
      history.record(await takeStudyAction(action, client));
      setRevealedId(undefined);
      setUndone(undefined);
      await refresh();
    });
  }
  /** Reverses the newest answer or card-menu action; its card comes back, on its front. */
  async function undo() {
    if (!history.canUndo) return;
    await guarded(async () => {
      setUndone(await history.undo());
      setRevealedId(undefined);
      await Promise.all([refresh(), client.invalidateQueries({ queryKey: COLLECTION_QUERY_KEY })]);
    });
  }
  return {
    preset,
    timer,
    intervals:
      query.data && cardId
        ? nextIntervals(query.data.collection, query.data.log, cardId, query.data.now)
        : undefined,
    counts: query.data
      ? studyCounts(query.data.collection, query.data.log, deckId, query.data.now)
      : undefined,
    query,
    next,
    card,
    note: next?.note,
    type: next?.type,
    busy,
    error,
    revealed,
    reveal: () => {
      timer.stop();
      setRevealedId(cardId);
    },
    answer,
    change,
    leave,
    canUndo: history.canUndo,
    undo,
    refresh,
  };
}
