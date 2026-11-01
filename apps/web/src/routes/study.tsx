import { autoAdvanceStep, deckPreset } from "@app/core";
import { StudyAudio } from "#/ui/study-audio.tsx";
import { useAutoAdvance } from "#/ui/use-auto-advance.ts";
import { useStudyTimer } from "#/ui/use-study-timer.ts";
import { editingCopy } from "#/editing-copy.ts";
import { nextStudyCard, type Grade, type LogEntry } from "@app/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { copy, type T } from "#/copy.ts";
import { webRequest } from "#/data/client.ts";
import { studyQuery } from "#/data/queries.ts";
import { CardFrame } from "#/ui/card-frame.tsx";
import { Button } from "#/ui/shadcn/button.tsx";

// The deck is a search parameter, so the offline shell has one /study page for every deck.
export const Route = createFileRoute("/study")({
  validateSearch: (search: Record<string, unknown>): { deck?: string } =>
    typeof search["deck"] === "string" ? { deck: search["deck"] } : {},
  component: Study,
});

/** Show the front, reveal the back, grade: the phone's flow, with Core rendering the card. */
function Study() {
  const { deck: deckId = "", lang = "pt-BR" } = Route.useSearch();
  const t = copy(lang);
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
          <CardFrame
            key={`${card.id}-${revealed}`}
            title={t(revealed ? "answer" : "front")}
            note={note}
            type={type}
            ordinal={card.fields.ordinal.value}
            side={revealed ? "back" : "front"}
            {...(deckName === undefined ? {} : { deckName })}
            className="min-h-80 flex-1"
          />
          {session.timer.show && (
            <p role="timer" aria-label={editingCopy(lang)("answerTimer")}>
              {session.timer.seconds}s
            </p>
          )}
          {session.preset && (
            <StudyAudio
              key={`${card.id}-${revealed}`}
              input={{ note, type, ordinal: card.fields.ordinal.value }}
              side={revealed ? "back" : "front"}
              preset={session.preset}
              locale={lang}
              onPlaying={session.audioPlaying}
              onFinished={session.audioFinished}
            />
          )}
          {session.reminder && (
            <p role="status" className="text-label text-attention">
              {editingCopy(lang)(revealed ? "answerReminder" : "questionReminder")}
            </p>
          )}
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

/** Where the session is: the card shown, its side, and this session's answers for Undo. */
interface SessionState {
  revealedId: string | undefined;
  /** This session's answers, newest last: what Undo voids. */
  answers: LogEntry[];
  /** The card Undo just brought back. */
  undone: string | undefined;
  status: "ready" | "saving" | "failed";
}

const GRADE_ACTIONS = { again: 1, hard: 2, good: 3 } as const;

function useStudySession(deckId: string) {
  const client = useQueryClient();
  /** The card and side whose audio has ended. */
  const [audioFinishedOn, setAudioFinishedOn] = useState<string>();
  const [state, setState] = useState<SessionState>({
    revealedId: undefined,
    answers: [],
    undone: undefined,
    status: "ready",
  });
  const lock = useRef(false);
  const query = useQuery(studyQuery(deckId));
  const next =
    query.data &&
    nextStudyCard(query.data.collection, query.data.log, deckId, query.data.now, state.undone);
  const cardId = next?.card.id;
  const revealed = Boolean(cardId && state.revealedId === cardId);
  const ownDeck = query.data?.collection.decks.find((d) => d.id === next?.card.fields.deckId.value);
  const preset = ownDeck && query.data ? deckPreset(query.data.collection, ownDeck) : undefined;
  const timer = useStudyTimer(query.data?.started, preset);
  /** One write at a time; then the card's front, and the session read again. */
  const write = async (operation: () => Promise<Partial<SessionState>>) => {
    if (lock.current) return;
    lock.current = true;
    setState((s) => ({ ...s, status: "saving" }));
    try {
      const change = await operation();
      setState((s) => ({ ...s, ...change, revealedId: undefined, status: "ready" }));
      await client.invalidateQueries({ queryKey: ["study", deckId] });
    } catch {
      setState((s) => ({ ...s, status: "failed" }));
    }
    lock.current = false;
  };
  const reveal = () => {
    timer.stop();
    setState((s) => ({ ...s, revealedId: cardId }));
  };
  const answer = (grade: Grade) =>
    write(async () => {
      if (!cardId || !revealed) return {};
      const entry = await webRequest("answerCard", cardId, grade, timer.duration());
      return { answers: [...state.answers, entry], undone: undefined };
    });
  const side = cardId && `${cardId}-${revealed}`;
  const autoAdvance = useAutoAdvance({
    side,
    step: preset && autoAdvanceStep(preset, revealed ? "back" : "front"),
    // A failed write keeps the card and waits for the user, rather than trying again by itself.
    held: state.status !== "ready",
    audioFinished: Boolean(side && audioFinishedOn === side),
    run: (action) => {
      if (!cardId) return;
      if (action === "showAnswer") reveal();
      else if (action === "bury")
        void write(async () => {
          await webRequest("buryCard", cardId);
          return { undone: undefined };
        });
      else void answer(GRADE_ACTIONS[action]);
    },
  });
  return {
    query,
    preset,
    timer,
    reminder: autoAdvance.reminder,
    audioPlaying: () => setAudioFinishedOn(undefined),
    audioFinished: () => setAudioFinishedOn(side),
    card: next?.card,
    note: next?.note,
    type: next?.type,
    busy: state.status === "saving",
    error: state.status === "failed",
    revealed,
    reveal,
    answer,
    canUndo: state.answers.length > 0,
    undo: () =>
      write(async () => {
        const last = state.answers.at(-1);
        if (!last) return {};
        await webRequest("undo", last.id);
        return { answers: state.answers.slice(0, -1), undone: last.cardId };
      }),
  };
}
