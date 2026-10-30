import { COLLECTION_QUERY_KEY } from "./collection-query.ts";
import { useNow } from "./clock.tsx";
import { StudyCounts } from "./StudyCounts.tsx";
import { useContext } from "react";
import { ScreenActivity } from "./screen-activity.ts";
import {
  cardMemory,
  studyCounts,
  cardsStayInApp,
  type Collection,
  type CollectionState,
  type Deck,
  type Locale,
  type LogEntry,
  type Note,
  type NoteDraft,
} from "@app/core";
import type { ClientData } from "@app/client-data";
import { useForm } from "@tanstack/react-form";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
import { NoteEditor } from "./NoteEditor.tsx";
import { StudyScreen } from "./StudyScreen.tsx";
import { pickAndImportApkg } from "./apkg.ts";
import { DeckExport } from "./DeckExport.tsx";
import { AnkiDroidScreen } from "./AnkiDroidScreen.tsx";
import { ankiDroidCopy } from "./ankidroid-copy.ts";
import type { AnkiDroidApi } from "./ankidroid.ts";
import { LinkedDeckPanel } from "./LinkedDeckPanel.tsx";

type Form = { kind: "deck"; id?: string } | { kind: "note"; id?: string } | { kind: "options" };
type Translate = ReturnType<typeof copy>;
/** Field text for the note list: markup and sound tags left out. */
const plain = (html: string | undefined) =>
  (html ?? "")
    .replace(/<[^>]*>|\[sound:[^\]]*\]/g, " ")
    .replaceAll("&nbsp;", " ")
    .replace(/\s+/g, " ")
    .trim();

function useCollectionData() {
  const query = useQuery({
    queryKey: COLLECTION_QUERY_KEY,
    queryFn: () => Effect.runPromise(localData((data) => data.collection)),
  });
  const log = useQuery({
    queryKey: ["reviewLog"],
    queryFn: () => Effect.runPromise(localData((data) => data.reviewLog)),
  });
  return { query, log };
}

export function CollectionScreen({
  locale,
  onExit,
  onTheme,
  ankiDroid,
  onStudy,
}: {
  locale: Locale;
  onStudy?: (deckId: string) => void;
  onExit?: () => void;
  onTheme: () => void;

  ankiDroid: AnkiDroidApi;
}) {
  const [linking, setLinking] = useState(false);
  const queryClient = useQueryClient();
  const { query, log } = useCollectionData();
  const state = query.data;
  const [studying, setStudying] = useState(false);
  const [deckId, setDeckId] = useState<string>();
  const [form, setForm] = useState<Form>();
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState("");
  const t = copy(locale);
  const goBack = useCallback(() => {
    if (studying || linking) return false;
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
  }, [form, deckId, t, studying, linking]);
  const screenActive = useContext(ScreenActivity);
  useEffect(() => {
    if (!screenActive) return undefined;
    const handler = BackHandler.addEventListener("hardwareBackPress", goBack);
    return () => handler.remove();
  }, [goBack, screenActive]);
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
        [COLLECTION_QUERY_KEY, ["reviewLog"], ["study"]].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
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
  async function importPackage() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(false);
    setNotice(t("importing"));
    try {
      const summary = await pickAndImportApkg();
      await queryClient.invalidateQueries({ queryKey: COLLECTION_QUERY_KEY });
      setNotice(
        summary
          ? t("imported", {
              notes: String(summary.notes),
              cards: String(summary.cards),
              entries: String(summary.entries),
            })
          : "",
      );
    } catch {
      setNotice(t("importError"));
    }
    locked.current = false;
    setBusy(false);
  }
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
  if (linking)
    return (
      <AnkiDroidScreen
        ankiDroid={ankiDroid}
        locale={locale}
        onExit={() => setLinking(false)}
        onOpen={(id) => {
          setLinking(false);
          setDeckId(id);
        }}
      />
    );
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
              linked={cardsStayInApp(state, cards)}
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
          remove={confirmDelete}
        />
      );
    return (
      <DeckList
        t={t}
        state={state}
        busy={busy}
        notice={notice}
        create={() => setForm({ kind: "deck" })}
        select={(id) => {
          setError(false);
          setNotice("");
          setDeckId(id);
        }}
        importPackage={() => void importPackage()}
      />
    );
  };
  return (
    <CollectionPage>
      <CollectionHeading
        t={t}
        locale={locale}
        form={form}
        deck={deck}
        busy={busy}
        goBack={goBack}
        onExit={onExit}
        onTheme={onTheme}
      />
      <DeckStudyStart
        deck={deck}
        editing={Boolean(form)}
        state={state}
        log={log.data}
        locale={locale}
        busy={busy}
        onStudy={onStudy}
        onLocalStudy={() => setStudying(true)}
      />
      <AnkiDroidEntry
        ankiDroid={ankiDroid}
        locale={locale}
        deck={deck}
        editing={form !== undefined}
        busy={busy}
        onLink={() => setLinking(true)}
      />
      {error || query.isError ? (
        <Text accessibilityRole="alert" style={regular} className="text-body text-destructive">
          {t(state ? "error" : "loadError")}
        </Text>
      ) : null}
      {content()}
    </CollectionPage>
  );
}
function CollectionHeading({
  t,
  locale,
  form,
  deck,
  busy,
  goBack,
  onExit,
  onTheme,
}: {
  t: Translate;
  locale: Locale;
  form: Form | undefined;
  deck: Deck | undefined;
  busy: boolean;
  goBack: () => void;
  onExit: (() => void) | undefined;
  onTheme: () => void;
}) {
  return (
    <>
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        {form || deck ? (
          <Button label={t("back")} disabled={busy} onPress={goBack} />
        ) : (
          onExit && <Button label={t("alarms")} disabled={busy} onPress={onExit} />
        )}
        {!form && !deck && <Button label={t("theme")} disabled={busy} onPress={onTheme} />}
      </View>
      <Text
        numberOfLines={2}
        accessibilityRole="header"
        style={bold}
        className="text-title text-foreground"
      >
        {screenTitle(t, locale, form, deck)}
      </Text>
    </>
  );
}

function CollectionPage({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      behavior="padding"
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <ScrollView contentContainerClassName="gap-6 p-6" keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** The primary deck action comes before linked-deck controls and editing. */
function DeckStudyStart({
  deck,
  editing,
  state,
  log,
  locale,
  busy,
  onStudy,
  onLocalStudy,
}: {
  deck: Deck | undefined;
  editing: boolean;
  state: CollectionState | undefined;
  log: readonly LogEntry[] | undefined;
  locale: Locale;
  busy: boolean;
  onStudy: ((id: string) => void) | undefined;
  onLocalStudy: () => void;
}) {
  const now = useNow();
  if (!deck || editing || !state || !log) return null;
  return (
    <>
      <StudyCounts counts={studyCounts(state, log, deck.id, now)} locale={locale} />
      <Button
        label={copy(locale)("study")}
        primary
        disabled={busy}
        onPress={() => (onStudy ? onStudy(deck.id) : onLocalStudy())}
      />
    </>
  );
}
/** On the deck list: the way to AnkiDroid. On a linked deck: that it is linked. */
function AnkiDroidEntry({
  ankiDroid,
  locale,
  deck,
  editing,
  busy,
  onLink,
}: {
  ankiDroid: AnkiDroidApi;
  locale: Locale;
  deck: Deck | undefined;
  editing: boolean;
  busy: boolean;
  onLink: () => void;
}) {
  const t = ankiDroidCopy(locale);
  if (editing) return null;
  if (!deck) return <Button label={t("entry")} disabled={busy} onPress={onLink} />;
  if (!deck.fields.linkedBy) return null;
  return <LinkedDeckPanel ankiDroid={ankiDroid} deck={deck} locale={locale} disabled={busy} />;
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
  remove,
}: {
  t: Translate;
  locale: Locale;
  deck: Deck;
  notes: Note[];
  busy: boolean;
  edit: (form: Form) => void;
  remove: () => void;
}) {
  return (
    <>
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
          accessibilityLabel={`${t("editNote")}: ${plain(note.values[0]?.value)}`}
          onPress={() => edit({ kind: "note", id: note.id })}
          className="min-h-16 gap-2 border-b border-border py-4 active:opacity-80"
        >
          <Text style={bold} className="text-body text-foreground">
            {plain(note.values[0]?.value)}
          </Text>
          <Text style={regular} className="text-body text-answer">
            {plain(note.values[1]?.value)}
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
      <DeckExport deckId={deck.id} locale={locale} busy={busy} />
      <Button label={t("delete")} destructive disabled={busy} onPress={remove} />
    </>
  );
}
function DeckList({
  t,
  state,
  busy,
  notice,
  create,
  select,
  importPackage,
}: {
  t: Translate;
  state: CollectionState;
  busy: boolean;
  notice: string;
  create: () => void;
  select: (id: string) => void;
  importPackage: () => void;
}) {
  return (
    <>
      <Button label={t("newDeck")} primary disabled={busy} onPress={create} />
      <Button label={t("importApkg")} disabled={busy} onPress={importPackage} />
      {notice ? (
        <Text
          accessibilityLiveRegion="polite"
          style={regular}
          className="text-body text-foreground"
        >
          {notice}
        </Text>
      ) : null}
      {!state.decks.length && (
        <Text style={regular} className="text-body text-muted-foreground">
          {t("empty")}
        </Text>
      )}
      {state.decks.map((d) => (
        <Pressable
          key={d.id}
          accessibilityRole="button"
          disabled={busy}
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
