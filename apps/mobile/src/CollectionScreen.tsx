import {
  type Collection,
  type CollectionState,
  type Deck,
  type Note,
  type Locale,
} from "@app/core";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { copy } from "./copy.ts";
import { localData } from "./database.ts";
import { Effect } from "effect";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { StudyScreen } from "./StudyScreen.tsx";
import { AnkiDroidScreen } from "./AnkiDroidScreen.tsx";
import { ankiDroidCopy } from "./ankidroid-copy.ts";
import type { AnkiDroidApi } from "./ankidroid.ts";
import { Button } from "./Button.tsx";

type Form = { kind: "deck" | "note"; id?: string; first: string; second: string };
const regular = { fontFamily: "AtkinsonHyperlegible_400Regular" };
const bold = { fontFamily: "AtkinsonHyperlegible_700Bold" };
/** Field text for the note list: markup and sound tags left out. */
const plain = (html: string | undefined) =>
  (html ?? "")
    .replace(/<[^>]*>|\[sound:[^\]]*\]/g, " ")
    .replaceAll("&nbsp;", " ")
    .replace(/\s+/g, " ")
    .trim();
function Field({
  label,
  value,
  onChange,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
}) {
  return (
    <View className="gap-2">
      <Text style={regular} className="text-label text-muted-foreground">
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        textAlignVertical="top"
        style={regular}
        className="min-h-12 rounded-lg border border-border bg-surface p-4 text-body text-foreground"
      />
    </View>
  );
}
export function CollectionScreen({
  locale,
  onExit,
  onTheme,
  ankiDroid,
}: {
  locale: Locale;
  onExit: () => void;
  onTheme: () => void;

  ankiDroid: AnkiDroidApi;
}) {
  const [linking, setLinking] = useState(false);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["collection"],
    queryFn: () => Effect.runPromise(localData((data) => data.collection)),
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
  const load = () => {
    void query.refetch();
  };
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
  async function change(command: (collection: Collection) => void, onSaved: () => void) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(false);
    try {
      await Effect.runPromise(localData((data) => data.changeCollection(command)));
      await queryClient.invalidateQueries({ queryKey: ["collection"] });
      onSaved();
    } catch {
      setError(true);
    }
    locked.current = false;
    setBusy(false);
  }
  const deck = state?.decks.find((d) => d.id === deckId);
  const notes = state?.notes.filter((n) => n.fields.deckId.value === deckId) ?? [];
  function save() {
    if (!form) return;
    void change(
      (c) => {
        if (form.kind === "deck") {
          if (form.id) c.renameDeck(form.id, form.first);
          else c.createDeck(form.first);
        } else if (form.id) c.editNote(form.id, [form.first, form.second]);
        else if (deckId) c.addBasicNote(deckId, form.first, form.second);
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
        <AnkiDroidEntry
          locale={locale}
          deck={deck}
          editing={form !== undefined}
          busy={busy}
          onLink={() => setLinking(true)}
        />
        <Text accessibilityRole="header" style={bold} className="text-title text-foreground">
          {screenTitle(t, form, deck)}
        </Text>
        {error || query.isError ? (
          <Text accessibilityRole="alert" style={regular} className="text-body text-destructive">
            {t(state ? "error" : "loadError")}
          </Text>
        ) : null}
        {deck && !form && <Button label={t("study")} primary onPress={() => setStudying(true)} />}
        <ScreenContent
          state={state}
          form={form}
          deck={deck}
          t={t}
          error={error || query.isError}
          busy={busy}
          notes={notes}
          retry={() => {
            setError(false);
            load();
          }}
          setForm={(next) => {
            setError(false);
            setForm(next);
          }}
          save={save}
          cancel={goBack}
          remove={confirmDelete}
          select={(id) => {
            setError(false);
            setDeckId(id);
          }}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
/** On the deck list: the way to AnkiDroid. On a linked deck: that it is linked. */
function AnkiDroidEntry({
  locale,
  deck,
  editing,
  busy,
  onLink,
}: {
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
  return (
    <Text style={regular} className="text-label text-muted-foreground">
      {t("linkedLabel")}
    </Text>
  );
}
type Translate = ReturnType<typeof copy>;
function Loading({ t, error, retry }: { t: Translate; error: boolean; retry: () => void }) {
  return (
    <>
      <Text style={regular} className="text-body text-muted-foreground">
        {error ? "" : t("loading")}
      </Text>
      {error && <Button label={t("retry")} onPress={retry} />}
    </>
  );
}
function Editor({
  t,
  form,
  setForm,
  busy,
  save,
  cancel,
}: {
  t: Translate;
  form: Form;
  setForm: (form: Form) => void;
  busy: boolean;
  save: () => void;
  cancel: () => void;
}) {
  return (
    <View className="gap-6" pointerEvents={busy ? "none" : "auto"}>
      {form.kind === "note" && (
        <Text style={regular} className="text-label text-muted-foreground">
          {t("basic")}
        </Text>
      )}
      <Field
        label={t(form.kind === "deck" ? "deckName" : "front")}
        value={form.first}
        onChange={(first) => setForm({ ...form, first })}
        multiline={form.kind === "note"}
      />
      {form.kind === "note" && (
        <Field
          label={t("answer")}
          value={form.second}
          onChange={(second) => setForm({ ...form, second })}
          multiline
        />
      )}
      <Button
        label={t(busy ? "saving" : "save")}
        primary
        disabled={busy || !form.first.trim()}
        onPress={save}
      />
      <Button label={t("cancel")} disabled={busy} onPress={cancel} />
    </View>
  );
}
function DeckDetails({
  t,
  deck,
  notes,
  busy,
  edit,
  remove,
}: {
  t: Translate;
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
      <Button
        label={t("addNote")}
        disabled={busy}
        onPress={() => edit({ kind: "note", first: "", second: "" })}
      />
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
          onPress={() =>
            edit({
              kind: "note",
              id: note.id,
              first: note.values[0]?.value ?? "",
              second: note.values[1]?.value ?? "",
            })
          }
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
        label={t("rename")}
        disabled={busy}
        onPress={() =>
          edit({ kind: "deck", id: deck.id, first: deck.fields.name.value, second: "" })
        }
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
function screenTitle(t: Translate, form: Form | undefined, deck: Deck | undefined) {
  if (!form) return deck?.fields.name.value ?? t("title");
  if (form.kind === "deck") return t(form.id ? "rename" : "newDeck");
  return t(form.id ? "editNote" : "addNote");
}
function ScreenContent({
  state,
  form,
  deck,
  t,
  error,
  busy,
  notes,
  retry,
  setForm,
  save,
  cancel,
  remove,
  select,
}: {
  state: CollectionState | undefined;
  form: Form | undefined;
  deck: Deck | undefined;
  t: Translate;
  error: boolean;
  busy: boolean;
  notes: Note[];
  retry: () => void;
  setForm: (form: Form) => void;
  save: () => void;
  cancel: () => void;
  remove: () => void;
  select: (id: string) => void;
}) {
  if (!state) return <Loading t={t} error={error} retry={retry} />;
  if (form)
    return <Editor t={t} form={form} setForm={setForm} busy={busy} save={save} cancel={cancel} />;
  if (deck)
    return (
      <DeckDetails t={t} deck={deck} notes={notes} busy={busy} edit={setForm} remove={remove} />
    );
  return (
    <DeckList
      t={t}
      state={state}
      create={() => setForm({ kind: "deck", first: "", second: "" })}
      select={select}
    />
  );
}
