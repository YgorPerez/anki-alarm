import {
  ankiDroidAccess,
  linkableAnkiDroidDecks,
  type AnkiDroidDeck,
  type Locale,
} from "@app/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Effect, Result } from "effect";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { AppState, BackHandler, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ankiDroidCopy } from "./ankidroid-copy.ts";
import { AnkiDroidError, type AnkiDroidApi } from "./ankidroid.ts";
import { Button } from "./controls.tsx";
import { localData } from "./database.ts";

const regular = { fontFamily: "AtkinsonHyperlegible_400Regular" };
const bold = { fontFamily: "AtkinsonHyperlegible_700Bold" };
type Translate = ReturnType<typeof ankiDroidCopy>;
type Linked = { deckId: string; name: string };
type Media = "idle" | "busy" | "error" | number;

/**
 * Links an AnkiDroid deck: checks AnkiDroid and its permission on every visit and resume, lists
 * its decks, imports one as this phone's linked deck, then takes media from an `.apkg` export.
 */
export function AnkiDroidScreen({
  ankiDroid,
  locale,
  onExit,
  onOpen,
}: {
  ankiDroid: AnkiDroidApi;
  locale: Locale;
  onExit: () => void;
  onOpen: (deckId: string) => void;
}) {
  const t = ankiDroidCopy(locale);
  const insets = useSafeAreaInsets();
  const session = useLinkSession(ankiDroid);
  const exit = useEffectEvent(() => {
    if (!session.busy.current) onExit();
  });
  useEffect(() => {
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      exit();
      return true;
    });
    return () => back.remove();
  }, []);
  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <ScrollView contentContainerClassName="gap-6 p-6">
        <View className="flex-row">
          <Button label={t("back")} disabled={Boolean(session.linking)} onPress={onExit} />
        </View>
        <Text accessibilityRole="header" style={bold} className="text-title text-foreground">
          {t("title")}
        </Text>
        <Body t={t} session={session} ankiDroid={ankiDroid} onOpen={onOpen} />
      </ScrollView>
    </View>
  );
}

type Session = ReturnType<typeof useLinkSession>;
function Body({
  t,
  session,
  ankiDroid,
  onOpen,
}: {
  t: Translate;
  session: Session;
  ankiDroid: AnkiDroidApi;
  onOpen: (deckId: string) => void;
}) {
  const { linked, view, refresh } = session;
  if (linked)
    return (
      <LinkedDeck
        t={t}
        linked={linked}
        media={session.media}
        onPick={() => void session.importMedia()}
        onOpen={() => onOpen(linked.deckId)}
      />
    );
  switch (view) {
    case "permission":
      return (
        <Explain t={t} text="permission">
          <Button
            label={t("allow")}
            primary
            onPress={() => void Effect.runPromise(ankiDroid.requestPermission).then(refresh)}
          />
        </Explain>
      );
    case "missing":
    case "outdated":
      return <Explain t={t} text={view} />;
    case "unavailable":
    case "failed":
      return (
        <Explain t={t} text={view}>
          <Button label={t("retry")} onPress={refresh} />
        </Explain>
      );
    case "checking":
      return (
        <Text style={regular} className="text-body text-muted-foreground">
          {t("checking")}
        </Text>
      );
    default:
      return (
        <DeckChoice
          t={t}
          decks={view}
          linking={session.linking}
          error={session.linkError}
          onLink={(deck) => void session.link(deck)}
        />
      );
  }
}

function useLinkSession(ankiDroid: AnkiDroidApi) {
  const client = useQueryClient();
  const status = useQuery({
    queryKey: ["ankidroid", "status"],
    networkMode: "always",
    queryFn: () => Effect.runPromise(ankiDroid.status),
  });
  const access = status.data === undefined ? undefined : ankiDroidAccess(status.data);
  const decks = useQuery({
    queryKey: ["ankidroid", "decks"],
    networkMode: "always",
    enabled: access === "ready",
    queryFn: () => Effect.runPromise(ankiDroid.decks),
  });
  const [linking, setLinking] = useState<string>();
  const [linked, setLinked] = useState<Linked>();
  const [linkError, setLinkError] = useState<AnkiDroidError["reason"] | "save">();
  const [media, setMedia] = useState<Media>("idle");
  const busy = useRef(false);

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["ankidroid"] });
  };
  // Granting in Settings, or installing AnkiDroid, happens outside the app.
  useEffect(() => {
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") void client.invalidateQueries({ queryKey: ["ankidroid"] });
    });
    return () => appState.remove();
  }, [client]);

  async function link(deck: AnkiDroidDeck) {
    if (busy.current) return;
    busy.current = true;
    setLinking(deck.name);
    setLinkError(undefined);
    const result = await Effect.runPromise(
      Effect.result(
        ankiDroid.readDeck(deck.id).pipe(
          Effect.mapError((error) => error.reason),
          Effect.flatMap((source) =>
            localData((data) => data.linkAnkiDroidDeck(source)).pipe(
              Effect.mapError(() => "save" as const),
            ),
          ),
        ),
      ),
    );
    if (Result.isSuccess(result)) {
      await client.invalidateQueries({ queryKey: ["collection"] });
      setLinked({ deckId: result.success, name: deck.name });
      setMedia("idle");
    } else setLinkError(result.failure);
    setLinking(undefined);
    busy.current = false;
  }

  async function importMedia() {
    if (busy.current) return;
    busy.current = true;
    setMedia("busy");
    try {
      const count = await Effect.runPromise(ankiDroid.importMedia);
      setMedia(count ?? "idle");
    } catch {
      setMedia("error");
    }
    busy.current = false;
  }

  const deckError = decks.error instanceof AnkiDroidError ? decks.error.reason : undefined;
  return {
    busy,
    linking,
    linked,
    linkError,
    media,
    link,
    importMedia,
    refresh,
    view: screenView(access, deckError, linkError, status.isError || decks.isError, decks.data),
  };
}

/** What the screen shows before a deck is linked. */
function screenView(
  access: ReturnType<typeof ankiDroidAccess> | undefined,
  deckError: AnkiDroidError["reason"] | undefined,
  linkError: AnkiDroidError["reason"] | "save" | undefined,
  failed: boolean,
  decks: AnkiDroidDeck[] | undefined,
): "permission" | "missing" | "outdated" | "unavailable" | "failed" | "checking" | AnkiDroidDeck[] {
  // A revoked grant shows up as a provider failure: ask again.
  if (access === "permission" || deckError === "permission" || linkError === "permission")
    return "permission";
  if (access === "missing" || access === "outdated") return access;
  if (access === "ready" && decks) return decks;
  if (failed) return deckError === "unavailable" ? "unavailable" : "failed";
  return "checking";
}

function Explain({
  t,
  text,
  children,
}: {
  t: Translate;
  text: "missing" | "outdated" | "permission" | "unavailable" | "failed";
  children?: React.ReactNode;
}) {
  return (
    <>
      <Text style={regular} className="text-body text-foreground">
        {t(text)}
      </Text>
      {children}
    </>
  );
}

function DeckChoice({
  t,
  decks,
  linking,
  error,
  onLink,
}: {
  t: Translate;
  decks: AnkiDroidDeck[];
  linking: string | undefined;
  error: AnkiDroidError["reason"] | "save" | undefined;
  onLink: (deck: AnkiDroidDeck) => void;
}) {
  const linkable = linkableAnkiDroidDecks(decks);
  return (
    <>
      <Text style={regular} className="text-body text-muted-foreground">
        {t(linkable.length ? "choose" : "none")}
      </Text>
      {error && (
        <Text accessibilityRole="alert" style={regular} className="text-body text-destructive">
          {t(error === "unavailable" ? "unavailable" : "linkError")}
        </Text>
      )}
      {linking && (
        <Text style={regular} className="text-body text-attention">
          {t("linking", { name: linking })}
        </Text>
      )}
      {linkable.map((deck) => (
        <Pressable
          key={deck.id}
          accessibilityRole="button"
          accessibilityLabel={deck.name}
          disabled={Boolean(linking)}
          onPress={() => onLink(deck)}
          className="min-h-16 justify-center border-b border-border py-4 active:opacity-80"
        >
          <Text style={regular} className="text-body text-foreground">
            {deck.name}
          </Text>
        </Pressable>
      ))}
    </>
  );
}

function LinkedDeck({
  t,
  linked,
  media,
  onPick,
  onOpen,
}: {
  t: Translate;
  linked: Linked;
  media: Media;
  onPick: () => void;
  onOpen: () => void;
}) {
  return (
    <>
      <Text style={regular} className="text-body text-foreground">
        {t("linked", { name: linked.name })}
      </Text>
      <Text style={regular} className="text-body text-muted-foreground">
        {t("media")}
      </Text>
      {typeof media === "number" && (
        <Text style={regular} className="text-body text-foreground">
          {t("imported", { count: String(media) })}
        </Text>
      )}
      {media === "error" && (
        <Text accessibilityRole="alert" style={regular} className="text-body text-destructive">
          {t("mediaError")}
        </Text>
      )}
      <Button
        label={t(media === "busy" ? "importing" : "pick")}
        disabled={media === "busy"}
        onPress={onPick}
      />
      <Button label={t("open")} primary disabled={media === "busy"} onPress={onOpen} />
    </>
  );
}
