import type { Locale } from "@app/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Effect } from "effect";
import { useEffect, useRef, useState } from "react";
import { BackHandler, KeyboardAvoidingView, ScrollView, Text } from "react-native";
import { copy } from "./copy.ts";
import { localData } from "./database.ts";
import { bold, regular } from "./fonts.ts";
import { NoteEditor } from "./NoteEditor.tsx";

/**
 * The note editor opened from a study card's menu, in place of the card. It edits the card's note
 * and keeps it in its deck: moving notes stays on the deck page. Save runs `onSaved` (the owner
 * re-reads its card) before `onClose`; Cancel and Back only close.
 */
export function StudyNoteEditor({
  cardId,
  locale,
  onSaved,
  onClose,
  onActivity,
}: {
  cardId: string;
  locale: Locale;
  onSaved: () => Promise<unknown>;
  onClose: () => void;
  /** Any touch or field change, so an alarm session knows someone is still there. */
  onActivity?: () => void;
}) {
  const t = copy(locale);
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const lock = useRef(false);
  const query = useQuery({
    queryKey: ["collection"],
    networkMode: "always",
    queryFn: () => Effect.runPromise(localData((data) => data.collection)),
  });
  useEffect(() => {
    const handler = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!lock.current) onClose();
      return true;
    });
    return () => handler.remove();
  }, [onClose]);
  const state = query.data;
  const card = state?.cards.find((c) => c.id === cardId);
  const note = state?.notes.find((n) => n.id === card?.fields.noteId.value);
  const deck = state?.decks.find((d) => d.id === card?.fields.deckId.value);
  const save = (noteId: string, values: readonly string[]) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(false);
    void Effect.runPromise(
      localData((data) => data.changeCollection((c) => c.editNote(noteId, values))),
    )
      .then(() => Promise.all([client.invalidateQueries({ queryKey: ["collection"] }), onSaved()]))
      .then(onClose, () => setError(true))
      .finally(() => {
        lock.current = false;
        setBusy(false);
      });
  };
  return (
    <KeyboardAvoidingView behavior="padding" className="flex-1">
      <ScrollView
        contentContainerClassName="gap-6 p-6"
        keyboardShouldPersistTaps="handled"
        onTouchStart={onActivity}
      >
        <Text accessibilityRole="header" style={bold} className="text-title text-foreground">
          {t("editNote")}
        </Text>
        {(error || query.isError) && (
          <Text accessibilityRole="alert" style={regular} className="text-body text-destructive">
            {t("error")}
          </Text>
        )}
        {state && note && deck ? (
          <NoteEditor
            note={note}
            noteTypes={state.noteTypes}
            decks={[deck]}
            deckId={deck.id}
            locale={locale}
            busy={busy}
            onChange={onActivity}
            onCancel={onClose}
            onSave={(draft) => save(note.id, draft.values)}
          />
        ) : (
          !query.isError && (
            <Text style={regular} className="text-body text-muted-foreground">
              {t("loading")}
            </Text>
          )
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
