import { renderCard, studyQueue, type Grade, type LogEntry } from "@app/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { copy, type T } from "#/copy.ts";
import { webData } from "#/data/client.ts";
import { studyQuery } from "#/data/queries.ts";
import { Button } from "#/ui/shadcn/button.tsx";

// The deck is a search parameter, so the offline shell has one /study page for every deck.
export const Route = createFileRoute("/study")({
  validateSearch: (search: Record<string, unknown>): { deck: string } => ({
    deck: typeof search["deck"] === "string" ? search["deck"] : "",
  }),
  component: Study,
});

/** Where card media load from. #53 copies each deck's files there. */
const mediaUrl = (name: string) => `/media/${encodeURIComponent(name)}`;

const darkQuery = "(prefers-color-scheme: dark)";
const subscribeDark = (listener: () => void) => {
  const media = window.matchMedia?.(darkQuery);
  media?.addEventListener("change", listener);
  return () => media?.removeEventListener("change", listener);
};
const useDark = () =>
  useSyncExternalStore(
    subscribeDark,
    () => window.matchMedia?.(darkQuery).matches ?? false,
    () => false,
  );

/** Show the front, reveal the back, grade: the phone's flow, with Core rendering the card. */
function Study() {
  const { deck: deckId, lang = "pt-BR" } = Route.useSearch();
  const t = copy(lang);
  const dark = useDark();
  const session = useStudySession(deckId);
  const { query, card, note, type, busy, error, revealed } = session;
  const deckName = query.data?.collection.decks.find((d) => d.id === deckId)?.fields.name.value;
  useStudyKeys(session);
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 p-6">
      <nav className="flex items-center justify-between gap-4">
        <Link
          to="/"
          search={lang === "en" ? { lang } : {}}
          className="text-label text-primary-ink underline underline-offset-4"
        >
          ‹ {t("back")}
        </Link>
        {session.canUndo && (
          <Button variant="ghost" size="lg" disabled={busy} onClick={() => void session.undo()}>
            {t("undo")}
          </Button>
        )}
      </nav>
      <h1 className="text-title font-bold">{deckName ?? t("study")}</h1>
      {(error || query.isError) && (
        <p role="alert" className="text-body text-destructive">
          {t("answerError")}
        </p>
      )}
      {card && note && type ? (
        <>
          <iframe
            key={`${card.id}-${revealed}-${dark}`}
            title={t(revealed ? "answer" : "front")}
            // Same origin for card media; no scripts, so a shared deck's HTML can't run code.
            sandbox="allow-same-origin"
            srcDoc={renderCard({
              note,
              type,
              ordinal: card.fields.ordinal.value,
              side: revealed ? "back" : "front",
              dark,
              media: mediaUrl,
              ...(deckName === undefined ? {} : { deckName }),
            })}
            className="min-h-80 w-full flex-1 rounded-lg border-0 bg-background"
          />
          <AnswerControls t={t} session={session} />
        </>
      ) : (
        <p role="status" className="text-body text-attention">
          {t(query.isPending ? "studyLoading" : "studyDone")}
        </p>
      )}
    </main>
  );
}

const GRADES = [
  { grade: 1, label: "again" },
  { grade: 2, label: "hard" },
  { grade: 3, label: "good" },
  { grade: 4, label: "easy" },
] as const;

function AnswerControls({ t, session }: { t: T; session: StudySession }) {
  if (!session.revealed)
    return (
      <Button variant="secondary" size="pill" disabled={session.busy} onClick={session.reveal}>
        {t("reveal")}
      </Button>
    );
  return (
    <div className="grid grid-cols-4 gap-2">
      {GRADES.map(({ grade, label }) => (
        <Button
          key={grade}
          variant={label}
          size="pill"
          disabled={session.busy}
          onClick={() => void session.answer(grade)}
        >
          {t(label)}
        </Button>
      ))}
    </div>
  );
}

/** Space or Enter shows the answer; 1 to 4 grade it. */
function useStudyKeys(session: StudySession) {
  const latest = useRef(session);
  useEffect(() => {
    latest.current = session;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest("button, a, input")) return;
      const current = latest.current;
      if (!current.card) return;
      if (!current.revealed && (event.key === " " || event.key === "Enter")) {
        event.preventDefault();
        current.reveal();
      } else if (current.revealed && ["1", "2", "3", "4"].includes(event.key)) {
        void current.answer(Number(event.key));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

type StudySession = ReturnType<typeof useStudySession>;

function useStudySession(deckId: string) {
  const client = useQueryClient();
  const [revealedId, setRevealedId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  /** This session's answers, newest last: what Undo voids. */
  const [answers, setAnswers] = useState<LogEntry[]>([]);
  const [undone, setUndone] = useState<string>();
  const lock = useRef(false);
  const query = useQuery(studyQuery(deckId));
  const queue = query.data
    ? studyQueue(query.data.collection, query.data.log, deckId, query.data.now)
    : [];
  // An undone card comes back first, as it was before the answer.
  const item = queue.find((c) => c.card.id === undone) ?? queue[0];
  const card = item?.card;
  const cardId = card?.id;
  const revealed = Boolean(cardId && revealedId === cardId);
  /** Runs one write at a time, then reads the session again. */
  const write = async (operation: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(false);
    try {
      await operation();
      setRevealedId(undefined);
      await client.invalidateQueries({ queryKey: ["study", deckId] });
    } catch {
      setError(true);
    }
    lock.current = false;
    setBusy(false);
  };
  const answer = (grade: Grade) =>
    write(async () => {
      if (!cardId || !revealed) return;
      const started = query.data?.started ?? performance.now();
      const entry = await webData().request(
        "answerCard",
        cardId,
        grade,
        Math.max(0, Math.round(performance.now() - started)),
      );
      setAnswers((list) => [...list, entry]);
      setUndone(undefined);
    });
  const undo = () =>
    write(async () => {
      const last = answers.at(-1);
      if (!last) return;
      await webData().request("undo", last.id);
      setAnswers((list) => list.slice(0, -1));
      setUndone(last.cardId);
    });
  const note = query.data?.collection.notes.find((n) => n.id === card?.fields.noteId.value);
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
