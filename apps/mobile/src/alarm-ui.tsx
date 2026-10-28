import type { alarmSession, Grade, Locale } from "@app/core";
import { useEffect, useRef, useState } from "react";
import { BackHandler, Pressable, Text } from "react-native";
import { bold } from "./alarm-screen.ts";
import { copy } from "./copy.ts";
import { AnswerControls, CardSide } from "./StudyScreen.tsx";

// What the alarm and awake check screens share: always dark, Back blocked, big pill buttons.

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

/** One operation at a time, with a busy flag and whether the last one failed. */
export function useGuarded() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const lock = useRef(false);
  const guarded = async (operation: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(false);
    setError(!(await succeeded(operation)));
    lock.current = false;
    setBusy(false);
  };
  return { busy, error, setError, guarded };
}

/** Which card's back is showing, and whether its grades are out yet (`gradeDelayMs` later). */
export function useReveal(cardId: string | undefined, gradeDelayMs: number) {
  const [revealedId, setRevealedId] = useState<string>();
  const [gradesFor, setGradesFor] = useState<string>();
  useEffect(() => {
    if (!revealedId) return undefined;
    const timer = setTimeout(() => setGradesFor(revealedId), gradeDelayMs);
    return () => clearTimeout(timer);
  }, [revealedId, gradeDelayMs]);
  return {
    revealed: Boolean(cardId && revealedId === cardId),
    gradesShown: Boolean(cardId && gradesFor === cardId),
    reveal: () => setRevealedId(cardId),
    hide: () => setRevealedId(undefined),
  };
}

/** Back never leaves an alarm screen. */
export function useBlockBack() {
  useEffect(() => {
    const handler = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => handler.remove();
  }, []);
}

/** The wall clock, refreshed every `everyMs`. */
export function useClock(everyMs = 15_000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

type Next = NonNullable<ReturnType<typeof alarmSession>["next"]>;
/** The card being answered: its front or back, then Show answer or the grades. */
export function AlarmCard({
  next,
  reveal,
  busy,
  locale,
  onReveal,
  onAnswer,
}: {
  next: Next;
  reveal: ReturnType<typeof useReveal>;
  busy: boolean;
  locale: Locale;
  onReveal: () => void;
  onAnswer: (grade: Grade) => Promise<void>;
}) {
  const t = copy(locale);
  return (
    <>
      <CardSide
        key={`${next.card.id}-${reveal.revealed}`}
        label={t(reveal.revealed ? "answer" : "front")}
        dark
        input={{
          note: next.note,
          type: next.noteType,
          ordinal: next.card.fields.ordinal.value,
          side: reveal.revealed ? "back" : "front",
          dark: true,
          deckName: next.deckName,
        }}
      />
      <AnswerControls
        revealed={reveal.revealed}
        gradesShown={reveal.gradesShown}
        busy={busy}
        locale={locale}
        onReveal={onReveal}
        onAnswer={onAnswer}
      />
    </>
  );
}

export function PillButton({
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
