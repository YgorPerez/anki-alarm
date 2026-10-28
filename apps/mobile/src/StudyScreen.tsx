import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  renderCard,
  studyQueue,
  type Grade,
  type Locale,
  type LogEntry,
  type RenderInput,
} from "@app/core";
import { Effect } from "effect";
import { useEffect, useRef, useState } from "react";
import { BackHandler, Pressable, Text, View, useColorScheme } from "react-native";
import { WebView } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { localData } from "./database.ts";
import { copy } from "./copy.ts";
import { editingCopy } from "./editing-copy.ts";
import { mediaBaseUrl, mediaUrl } from "./apkg.ts";

export function StudyScreen({
  deckId,
  locale,
  onExit,
}: {
  deckId: string;
  locale: Locale;
  onExit: () => void;
}) {
  const t = copy(locale);
  const insets = useSafeAreaInsets();
  const dark = useColorScheme() === "dark";
  const { query, card, note, type, busy, error, revealed, reveal, answer, canUndo, undo } =
    useStudySession(deckId, onExit);
  const deckName = query.data?.collection.decks.find((d) => d.id === deckId)?.fields.name.value;
  return (
    <View
      className="flex-1 gap-4 bg-background px-6"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom + 16 }}
    >
      <View className="flex-row items-center justify-between">
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onExit}
          className="min-h-12 justify-center"
        >
          <Text className="text-body text-foreground">{t("back")}</Text>
        </Pressable>
        {canUndo && (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => {
              void undo();
            }}
            className="min-h-12 justify-center px-2"
          >
            <Text className="text-body text-foreground">{editingCopy(locale)("undo")}</Text>
          </Pressable>
        )}
      </View>
      <Text
        accessibilityRole="header"
        className="text-title text-foreground"
        style={{ fontFamily: "AtkinsonHyperlegible_700Bold" }}
      >
        {deckName ?? t("study")}
      </Text>
      {(error || query.isError) && (
        <Text accessibilityRole="alert" className="text-body text-destructive">
          {t("error")}
        </Text>
      )}
      {query.isError && (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void query.refetch();
          }}
        >
          <Text>{t("retry")}</Text>
        </Pressable>
      )}
      {card && note && type ? (
        <>
          <CardSide
            key={`${card.id}-${revealed}-${dark}`}
            label={t(revealed ? "answer" : "front")}
            dark={dark}
            input={{
              note,
              type,
              ordinal: card.fields.ordinal.value,
              side: revealed ? "back" : "front",
              dark,
              ...(deckName === undefined ? {} : { deckName }),
            }}
          />
          <AnswerControls
            revealed={revealed}
            busy={busy}
            locale={locale}
            onReveal={reveal}
            onAnswer={answer}
          />
        </>
      ) : (
        <Text className="text-body text-attention">
          {t(query.isPending ? "loading" : "studyDone")}
        </Text>
      )}
    </View>
  );
}
/** A card side in a WebView without JavaScript. Card media load from local files only. */
function CardSide({ label, dark, input }: { label: string; dark: boolean; input: RenderInput }) {
  const baseUrl = mediaBaseUrl();
  return (
    <WebView
      accessibilityLabel={label}
      style={{ flex: 1, backgroundColor: dark ? "#000" : "#fff" }}
      source={{ html: renderCard({ ...input, media: mediaUrl }), baseUrl }}
      javaScriptEnabled={false}
      allowFileAccess
      originWhitelist={["about:*", "file://*"]}
      onShouldStartLoadWithRequest={(request) =>
        request.url === "about:blank" || request.url === baseUrl
      }
    />
  );
}
const gradeLabels = { 1: "again", 2: "hard", 3: "good", 4: "easy" } as const;
const gradeClasses = { 1: "bg-again-tint", 2: "bg-hard-tint", 3: "bg-good", 4: "bg-easy-tint" };
const gradeText = { 1: "text-again", 2: "text-hard", 3: "text-good-foreground", 4: "text-easy" };

function AnswerControls({
  revealed,
  busy,
  locale,
  onReveal,
  onAnswer,
}: {
  revealed: boolean;
  busy: boolean;
  locale: Locale;
  onReveal: () => void;
  onAnswer: (grade: Grade) => Promise<void>;
}) {
  const t = copy(locale);
  if (!revealed)
    return (
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={onReveal}
        className="min-h-16 items-center justify-center rounded-full bg-surface"
      >
        <Text className="text-body text-foreground">{t("reveal")}</Text>
      </Pressable>
    );
  return (
    <View className="flex-row gap-2">
      {([1, 2, 3, 4] as const).map((grade) => (
        <Pressable
          key={grade}
          accessibilityRole="button"
          disabled={busy}
          onPress={() => {
            void onAnswer(grade);
          }}
          className={`min-h-16 flex-1 items-center justify-center rounded-full px-1 ${gradeClasses[grade]}`}
        >
          <Text
            className={`text-label ${gradeText[grade]}`}
            style={{ fontFamily: "AtkinsonHyperlegible_700Bold" }}
          >
            {t(gradeLabels[grade])}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function useStudySession(deckId: string, onExit: () => void) {
  const client = useQueryClient();
  const [revealedId, setRevealedId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  /** This session's answers, newest last: what Undo voids. */
  const [answers, setAnswers] = useState<LogEntry[]>([]);
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
  const queue = query.data
    ? studyQueue(query.data.collection, query.data.log, deckId, query.data.now)
    : [];
  // An undone card comes back first, as it was before the answer.
  const item = queue.find((c) => c.card.id === undone) ?? queue[0];
  const card = item?.card;
  const cardId = card?.id;
  const revealed = Boolean(cardId && revealedId === cardId);
  useEffect(() => {
    const handler = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!lock.current) onExit();
      return true;
    });
    return () => handler.remove();
  }, [onExit]);
  async function answer(grade: Grade) {
    if (!cardId || !revealed || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(false);
    try {
      const entry = await Effect.runPromise(
        localData((data) =>
          data.answerCard(
            cardId,
            grade,
            Math.max(0, performance.now() - (query.data?.started ?? performance.now())),
          ),
        ),
      );
      setAnswers((list) => [...list, entry]);
      setUndone(undefined);
      setRevealedId(undefined);
      await client.invalidateQueries({ queryKey: ["study", deckId] });
    } catch {
      setError(true);
    }
    lock.current = false;
    setBusy(false);
  }
  async function undo() {
    const last = answers.at(-1);
    if (!last || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(false);
    try {
      await Effect.runPromise(localData((data) => data.undo(last.id)));
      setAnswers((list) => list.slice(0, -1));
      setUndone(last.cardId);
      setRevealedId(undefined);
      await client.invalidateQueries({ queryKey: ["study", deckId] });
    } catch {
      setError(true);
    }
    lock.current = false;
    setBusy(false);
  }
  const note = query.data?.collection.notes.find((n) => n.id === item?.card.fields.noteId.value);
  const type = query.data?.collection.noteTypes.find((n) => n.id === note?.fields.noteTypeId.value);

  return {
    query,
    card,
    note,
    type,
    busy,
    error,
    revealed,
    reveal: () => setRevealedId(cardId),
    answer,
    canUndo: answers.length > 0,
    undo,
  };
}
