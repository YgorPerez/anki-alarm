import type { ImportSummary } from "@app/client-data";
import type { Locale } from "@app/core";
import { useRef, useState } from "react";

import { write } from "#/data/write.ts";
import { editingCopy } from "#/editing-copy.ts";
import { Notice } from "#/ui/form.tsx";
import { Button } from "#/ui/shadcn/button.tsx";

type State = { kind: "idle" | "busy" | "failed" } | { kind: "done"; summary: ImportSummary };

/** Picks an Anki `.apkg` and imports it: media into the browser's storage, then the records. */
export function ApkgImport({ locale }: { locale: Locale }) {
  const t = editingCopy(locale);
  const picker = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ kind: "idle" });
  const busy = state.kind === "busy";
  return (
    <div className="flex flex-col items-start gap-2">
      <Button variant="outline" size="lg" disabled={busy} onClick={() => picker.current?.click()}>
        {busy ? t("importing") : t("importApkg")}
      </Button>
      <input
        ref={picker}
        type="file"
        accept=".apkg"
        aria-label={t("importApkg")}
        className="sr-only"
        tabIndex={-1}
        disabled={busy}
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setState({ kind: "busy" });
          try {
            const summary = await write("importApkg", new Uint8Array(await file.arrayBuffer()));
            setState({ kind: "done", summary });
          } catch {
            setState({ kind: "failed" });
          }
        }}
      />
      {state.kind === "done" && (
        <Notice tone="muted">
          {t("imported", {
            notes: String(state.summary.notes),
            cards: String(state.summary.cards),
            entries: String(state.summary.entries),
          })}
        </Notice>
      )}
      {state.kind === "failed" && <Notice tone="error">{t("importError")}</Notice>}
    </div>
  );
}
