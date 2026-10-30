import { translator, type Locale, type Messages } from "@app/core";
import type { ImportSummary } from "@app/client-data";
import { useState } from "react";
import { Text, View } from "react-native";
import { Button } from "./controls.tsx";
import { copy } from "./copy.ts";
import { bold, regular } from "./fonts.ts";

const messages = {
  "pt-BR": {
    noDecks: "Importe um baralho para criar seu primeiro alarme",
    noDecksBody: "O alarme só desliga depois que você acerta cartões de um baralho.",
    importApkg: "Importar .apkg",
    linkAnkiDroid: "Vincular do AnkiDroid",
    noAlarms: "Crie seu primeiro alarme",
    noAlarmsBody: "Escolha a hora, o baralho e quantos cartões acertar para ele parar.",
    createAlarm: "Criar alarme",
  },
  en: {
    noDecks: "Import a deck to create your first alarm",
    noDecksBody: "The alarm only stops once you get cards from a deck right.",
    importApkg: "Import .apkg",
    linkAnkiDroid: "Link AnkiDroid",
    noAlarms: "Create your first alarm",
    noAlarmsBody: "Pick the time, the deck and how many cards to get right to stop it.",
    createAlarm: "Create alarm",
  },
} satisfies Messages<string>;
const homeEmptyCopy = (locale: Locale) =>
  translator<keyof (typeof messages)["pt-BR"]>(messages, locale);

/** How Home gets a first deck. Home shows the import's progress and result. */
export type DeckSetup = {
  /** Picks and imports a package; undefined when the picker is cancelled. */
  onImport: () => Promise<ImportSummary | undefined>;
  onLink: () => void;
};

/**
 * The guided state at the top of an empty Home: a way to get a deck while there's none, then an
 * invitation to the first alarm. One component for both keeps the import's result on screen as the
 * new deck arrives.
 */
export function HomeEmptyState({
  locale,
  hasDecks,
  setup,
  onAdd,
}: {
  locale: Locale;
  hasDecks: boolean;
  setup: DeckSetup;
  onAdd: () => void;
}) {
  const t = homeEmptyCopy(locale);
  const shared = copy(locale);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState("");
  async function importPackage() {
    setImporting(true);
    setNotice(shared("importing"));
    try {
      const summary = await setup.onImport();
      setNotice(
        summary
          ? shared("imported", {
              notes: String(summary.notes),
              cards: String(summary.cards),
              entries: String(summary.entries),
            })
          : "",
      );
    } catch {
      setNotice(shared("importError"));
    }
    setImporting(false);
  }
  return (
    <View className="gap-4">
      <Text accessibilityRole="header" style={bold} className="text-title text-foreground">
        {t(hasDecks ? "noAlarms" : "noDecks")}
      </Text>
      <Text style={regular} className="text-body text-muted-foreground">
        {t(hasDecks ? "noAlarmsBody" : "noDecksBody")}
      </Text>
      {notice ? (
        <Text
          accessibilityLiveRegion="polite"
          style={regular}
          className="text-body text-foreground"
        >
          {notice}
        </Text>
      ) : null}
      {hasDecks ? (
        <Button label={t("createAlarm")} onPress={onAdd} />
      ) : (
        <>
          <Button
            label={t("importApkg")}
            disabled={importing}
            onPress={() => void importPackage()}
          />
          <Button label={t("linkAnkiDroid")} disabled={importing} onPress={setup.onLink} />
        </>
      )}
    </View>
  );
}
