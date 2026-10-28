import type { Locale } from "@app/core";
import { useState } from "react";
import { Text } from "react-native";
import { exportApkg } from "./apkg.ts";
import { Button } from "./controls.tsx";
import { copy } from "./copy.ts";
import { regular } from "./fonts.ts";

/**
 * Exports a deck with its subdecks as an `.apkg` into a folder the user picks, and says what Anki
 * needs to keep the schedule. Leaving the folder picker says nothing.
 */
export function DeckExport({
  deckId,
  locale,
  busy,
}: {
  deckId: string;
  locale: Locale;
  busy: boolean;
}) {
  const t = copy(locale);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState("");
  async function run() {
    setRunning(true);
    setNotice(t("exporting"));
    try {
      const file = await exportApkg(deckId);
      setNotice(file ? t("exported", { file }) : "");
    } catch {
      setNotice(t("exportError"));
    }
    setRunning(false);
  }
  return (
    <>
      <Button label={t("exportApkg")} disabled={busy || running} onPress={() => void run()} />
      <Text style={regular} className="text-label text-muted-foreground">
        {t("exportHint")}
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
    </>
  );
}
