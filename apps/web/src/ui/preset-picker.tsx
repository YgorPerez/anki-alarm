import {
  isDefaultPreset,
  type CollectionCommand,
  type CollectionState,
  type Locale,
  type Preset,
} from "@app/core";
import { useState } from "react";
import { editingCopy } from "#/editing-copy.ts";
import { Field, TextField } from "#/ui/form.tsx";
import { Button } from "#/ui/shadcn/button.tsx";

export function PresetPicker({
  state,
  preset,
  deckId,
  locale,
  onChange,
}: {
  state: CollectionState;
  preset: Preset;
  deckId: string;
  locale: Locale;
  onChange: (command: CollectionCommand) => Promise<void>;
}) {
  const t = editingCopy(locale);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function apply(command: CollectionCommand) {
    setBusy(true);
    setFailed(false);
    try {
      await onChange(command);
      setName("");
    } catch {
      setFailed(true);
    }
    setBusy(false);
  }
  return (
    <fieldset disabled={busy} className="flex flex-col gap-4">
      <Field label={t("preset")}>
        {(props) => (
          <select
            {...props}
            value={preset.id}
            className="min-h-12 rounded-lg border bg-surface p-3"
            onChange={(event) =>
              void apply({ kind: "setDeckPreset", deckId, presetId: event.target.value })
            }
          >
            {state.presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fields.name.value}
              </option>
            ))}
          </select>
        )}
      </Field>
      <p className="text-label text-muted-foreground">
        {t("usedByDecks", {
          count: String(state.decks.filter((d) => d.fields.presetId.value === preset.id).length),
        })}
      </p>
      <TextField label={t("presetActionName")} value={name} onChange={setName} />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={!name.trim()}
          onClick={() => void apply({ kind: "createPreset", deckId, name })}
        >
          {t("createPreset")}
        </Button>
        <Button
          variant="outline"
          disabled={!name.trim()}
          onClick={() => void apply({ kind: "duplicatePreset", id: preset.id, deckId, name })}
        >
          {t("duplicatePreset")}
        </Button>
        <Button
          variant="outline"
          disabled={!name.trim()}
          onClick={() => void apply({ kind: "updatePreset", id: preset.id, patch: { name } })}
        >
          {t("renamePreset")}
        </Button>
        <Button
          variant="outline"
          disabled={isDefaultPreset(preset)}
          onClick={() => {
            if (window.confirm(t("deletePresetConfirm")))
              void apply({ kind: "deletePreset", id: preset.id });
          }}
        >
          {t("deletePreset")}
        </Button>
      </div>
      {failed && <p role="alert">{t("presetFailed")}</p>}
    </fieldset>
  );
}
