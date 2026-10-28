import {
  cardMemory,
  type Collection,
  type CollectionState,
  type Deck,
  type Locale,
  type Note,
} from "@app/core";
import type { ClientData } from "@app/client-data";
import { useForm } from "@tanstack/react-form";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { copy } from "./copy.ts";
import { localData } from "./database.ts";
import { Effect } from "effect";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, SaveButtons, TextField } from "./controls.tsx";
import { CardActions } from "./CardActions.tsx";
import { DeckOptionsEditor } from "./DeckOptionsEditor.tsx";
import { editingCopy } from "./editing-copy.ts";
import { bold, regular } from "./fonts.ts";
import { NoteEditor, type NoteDraft } from "./NoteEditor.tsx";
import { StudyScreen } from "./StudyScreen.tsx";

type Form = { kind: "deck"; id?: string } | { kind: "note"; id?: string } | { kind: "options" };
type Translate = ReturnType<typeof copy>;

export function CollectionScreen({
  locale,
  onExit,
  onTheme,
}: {
  locale: Locale;
  onExit: () => void;
  onTheme: () => void;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["collection"],
    queryFn: () => Effect.runPromise(localData((data) => data.collection)),
  });
  const log = useQuery({
    queryKey: ["reviewLog"],
    queryFn: () => Effect.runPromise(localData((data) => data.reviewLog)),
  });
  const state = query.data;
  const [studying, setStudying] = useState(false);
  const [deckId, setDeckId] = useState<string>();
  const [form, setForm] = useState<Form>();
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [error, setError] = useState(false);
  const t = copy(locale);
  const insets = useSafeAreaInsets();
  const goBack = useCallback(() => {
    if (studying) return false;
    if (locked.current) return true;
    if (form) {
      Alert.alert(t("discardTitle"), t("discardBody"), [
        { text: t("cancel"), style: "cancel" },
        {
          text: t("discard"),
          style: "destructive",
          onPress: () => {
            setForm(undefined);
            setError(false);
          },
        },
      ]);
      return true;
    }
    if (deckId) {
      setDeckId(undefined);
      setError(false);
      return true;
    }
    return false;
  }, [form, deckId, t, studying]);
  useEffect(() => {
    const handler = BackHandler.addEventListener("hardwareBackPress", goBack);
    return () => handler.remove();
  }, [goBack]);
  /** Runs one write at a time; the previous data stays on screen when it fails. */
  async function write(
    task: (data: ClientData["Service"]) => Effect.Effect<unknown, Error>,
    onSaved: () => void = () => {},
  ) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(false);
    try {
      await Effect.runPromise(localData(task));
      await Promise.all(
        ["collection", "reviewLog", "study"].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      );
      onSaved();
    } catch {
      setError(true);
    }
    locked.current = false;
    setBusy(false);
  }
  const change = (command: (collection: Collection) => void, onSaved: () => void) =>
    write((data) => data.changeCollection(command), onSaved);
  const deck = state?.decks.find((d) => d.id === deckId);
  const cancel = () => {
    setError(false);
    setForm(undefined);
  };
  function saveNote(draft: NoteDraft, id: string | undefined) {
    void change(
      (c: Collection) => {
        if (id) {
          c.editNote(id, draft.values);
          c.moveCards(cardsOf(state, id), draft.deckId);
        } else if (draft.noteTypeId) c.addNote(draft.deckId, draft.noteTypeId, draft.values);
        else c.addBasicNote(draft.deckId, draft.values[0] ?? "", draft.values[1] ?? "");
      },
      () => setForm(undefined),
    );
  }
  function confirmDelete() {
    if (!deckId) return;
    Alert.alert(t("deleteTitle"), t("deleteBody"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("delete"),
        style: "destructive",
        onPress: () => {
          void change(
            (c) => c.deleteDeck(deckId),
            () => setDeckId(undefined),
          );
        },
      },
    ]);
  }
  if (studying && deckId)
    return <StudyScreen deckId={deckId} locale={locale} onExit={() => setStudying(false)} />;
  const content = () => {
    if (!state)
      return (
        <>
          <Text style={regular} className="text-body text-muted-foreground">
            {query.isError ? "" : t("loading")}
          </Text>
          {query.isError && <Button label={t("retry")} onPress={() => void query.refetch()} />}
        </>
      );
    if (form?.kind === "deck")
      return (
        <DeckNameEditor
          locale={locale}
          busy={busy}
          name={state.decks.find((d) => d.id === form.id)?.fields.name.value ?? ""}
          onCancel={cancel}
          onSave={(name) =>
            void change(
              (c) => {
                if (form.id) c.renameDeck(form.id, name);
                else c.createDeck(name);
              },
              () => setForm(undefined),
            )
          }
        />
      );
    if (form?.kind === "note" && deck) {
      const note = state.notes.find((n) => n.id === form.id);
      const cards = state.cards.filter((c) => c.fields.noteId.value === note?.id);
      return (
        <>
          <NoteEditor
            note={note}
            noteTypes={state.noteTypes}
            decks={state.decks}
            deckId={cards[0]?.fields.deckId.value ?? deck.id}
            locale={locale}
            busy={busy}
            onCancel={cancel}
            onSave={(draft) => saveNote(draft, note?.id)}
          />
          {note && (
            <CardActions
              cards={cards}
              memory={(cardId) => cardMemory(state, log.data ?? [], cardId, Date.now())}
              locale={locale}
              busy={busy || !log.data}
              onForget={(cardId) => void write((data) => data.forgetCard(cardId))}
              onSetDueDate={(cardId, days) => void write((data) => data.setDueDate(cardId, days))}
            />
          )}
        </>
      );
    }
    const preset = state.presets.find((p) => p.id === deck?.fields.presetId.value);
    if (form?.kind === "options" && preset)
      return (
        <DeckOptionsEditor
          preset={preset}
          deckCount={state.decks.filter((d) => d.fields.presetId.value === preset.id).length}
          locale={locale}
          busy={busy}
          onCancel={cancel}
          onSave={(options) =>
            void change(
              (c: Collection) => c.updatePreset(preset.id, options),
              () => setForm(undefined),
            )
          }
        />
      );
    if (deck)
      return (
        <DeckDetails
          t={t}
          locale={locale}
          deck={deck}
          notes={notesIn(state, deck.id)}
          busy={busy}
          edit={(next) => {
            setError(false);
            setForm(next);
          }}
          study={() => setStudying(true)}
          remove={confirmDelete}
        />
      );
    return (
      <DeckList
        t={t}
        state={state}
        create={() => setForm({ kind: "deck" })}
        select={(id) => {
          setError(false);
          setDeckId(id);
        }}
      />
    );
  };
  return (
    <KeyboardAvoidingView
      behavior="padding"
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <ScrollView contentContainerClassName="gap-6 p-6" keyboardShouldPersistTaps="handled">
        <View className="flex-row flex-wrap items-center justify-between gap-2">
          {form || deck ? (
            <Button label={t("back")} disabled={busy} onPress={goBack} />
          ) : (
            <Button label={t("alarms")} disabled={busy} onPress={onExit} />
          )}
          {!form && !deck && <Button label={t("theme")} disabled={busy} onPress={onTheme} />}
        </View>
        <Text accessibilityRole="header" style={bold} className="text-title text-foreground">
          {screenTitle(t, locale, form, deck)}
        </Text>
        {error || query.isError ? (
          <Text accessibilityRole="alert" style={regular} className="text-body text-destructive">
            {t(state ? "error" : "loadError")}
          </Text>
        ) : null}
        {content()}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
const cardsOf = (state: CollectionState | undefined, noteId: string) =>
  state?.cards.filter((c) => c.fields.noteId.value === noteId).map((c) => c.id) ?? [];
/** Notes with a card in the deck. Cards, not notes, belong to decks. */
const notesIn = (state: CollectionState, deckId: string) => {
  const ids = new Set(
    state.cards.filter((c) => c.fields.deckId.value === deckId).map((c) => c.fields.noteId.value),
  );
  return state.notes.filter((n) => ids.has(n.id));
};
function DeckNameEditor({
  locale,
  name,
  busy,
  onSave,
  onCancel,
}: {
  locale: Locale;
  name: string;
  busy: boolean;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const t = copy(locale);
  const form = useForm({
    defaultValues: { name },
    onSubmit: ({ value }) => onSave(value.name),
  });
  return (
    <View className="gap-6" pointerEvents={busy ? "none" : "auto"}>
      <form.Field name="name">
        {(field) => (
          <TextField
            label={t("deckName")}
            value={field.state.value}
            onChange={field.handleChange}
            onBlur={field.handleBlur}
          />
        )}
      </form.Field>
      <form.Subscribe selector={(s) => Boolean(s.values.name.trim())}>
        {(named) => (
          <SaveButtons
            locale={locale}
            busy={busy}
            disabled={!named}
            onSave={() => {
              void form.handleSubmit();
            }}
            onCancel={onCancel}
          />
        )}
      </form.Subscribe>
    </View>
  );
}
function DeckDetails({
  t,
  locale,
  deck,
  notes,
  busy,
  edit,
  study,
  remove,
}: {
  t: Translate;
  locale: Locale;
  deck: Deck;
  notes: Note[];
  busy: boolean;
  edit: (form: Form) => void;
  study: () => void;
  remove: () => void;
}) {
  return (
    <>
      <Button label={t("study")} primary disabled={busy} onPress={study} />
      <Text style={regular} className="text-label text-muted-foreground">
        {notes.length} {t("cards")}
      </Text>
      <Button label={t("addNote")} disabled={busy} onPress={() => edit({ kind: "note" })} />
      {!notes.length && (
        <Text style={regular} className="text-body text-muted-foreground">
          {t("emptyDeck")}
        </Text>
      )}
      {notes.map((note) => (
        <Pressable
          key={note.id}
          accessibilityRole="button"
          disabled={busy}
          accessibilityLabel={`${t("editNote")}: ${note.values[0]?.value ?? ""}`}
          onPress={() => edit({ kind: "note", id: note.id })}
          className="min-h-16 gap-2 border-b border-border py-4 active:opacity-80"
        >
          <Text style={bold} className="text-body text-foreground">
            {note.values[0]?.value}
          </Text>
          <Text style={regular} className="text-body text-answer">
            {note.values[1]?.value}
          </Text>
        </Pressable>
      ))}
      <Button
        label={editingCopy(locale)("deckOptions")}
        disabled={busy}
        onPress={() => edit({ kind: "options" })}
      />
      <Button
        label={t("rename")}
        disabled={busy}
        onPress={() => edit({ kind: "deck", id: deck.id })}
      />
      <Button label={t("delete")} destructive disabled={busy} onPress={remove} />
    </>
  );
}
function DeckList({
  t,
  state,
  create,
  select,
}: {
  t: Translate;
  state: CollectionState;
  create: () => void;
  select: (id: string) => void;
}) {
  return (
    <>
      <Button label={t("newDeck")} primary onPress={create} />
      {!state.decks.length && (
        <Text style={regular} className="text-body text-muted-foreground">
          {t("empty")}
        </Text>
      )}
      {state.decks.map((d) => (
        <Pressable
          key={d.id}
          accessibilityRole="button"
          onPress={() => select(d.id)}
          className="min-h-16 flex-row flex-wrap items-center justify-between gap-2 border-b border-border py-4 active:opacity-80"
        >
          <Text style={regular} className="text-body text-foreground">
            {d.fields.name.value}
          </Text>
          <Text style={regular} className="text-label text-muted-foreground">
            {state.cards.filter((c) => c.fields.deckId.value === d.id).length} {t("cards")}
          </Text>
        </Pressable>
      ))}
    </>
  );
}
function screenTitle(t: Translate, locale: Locale, form: Form | undefined, deck: Deck | undefined) {
  if (!form) return deck?.fields.name.value ?? t("title");
  if (form.kind === "options") return editingCopy(locale)("deckOptions");
  if (form.kind === "deck") return t(form.id ? "rename" : "newDeck");
  return t(form.id ? "editNote" : "addNote");
}
