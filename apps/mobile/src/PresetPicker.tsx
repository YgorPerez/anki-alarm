import {
  isDefaultPreset,
  type CollectionCommand,
  type CollectionState,
  type Locale,
  type Preset,
} from "@app/core";
import { presetChoices, usedByDecksText } from "@app/editing-ui";
import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { Button, Choice, TextField } from "./controls.tsx";
import { editingCopy } from "./editing-copy.ts";
import { regular } from "./fonts.ts";

export function PresetPicker({
  state,
  preset,
  deckId,
  locale,
  busy,
  onChange,
}: {
  state: CollectionState;
  preset: Preset;
  deckId: string;
  locale: Locale;
  busy: boolean;
  onChange: (command: CollectionCommand, onSaved: () => void) => void;
}) {
  const t = editingCopy(locale);
  const [name, setName] = useState("");
  const [managing, setManaging] = useState(false);
  const apply = (command: CollectionCommand) => onChange(command, () => setName(""));
  return (
    <View className="gap-4" pointerEvents={busy ? "none" : "auto"}>
      <Choice
        label={t("preset")}
        options={presetChoices(state.presets, locale)}
        value={preset.id}
        disabled={busy}
        onChange={(presetId) => {
          if (presetId !== preset.id) apply({ kind: "setDeckPreset", deckId, presetId });
        }}
      />
      <Text style={regular} className="text-label text-muted-foreground">
        {usedByDecksText(
          state.decks.filter((d) => d.fields.presetId.value === preset.id).length,
          locale,
        )}
      </Text>
      <Button
        label={t("managePresets")}
        expanded={managing}
        onPress={() => setManaging(!managing)}
      />
      {managing && (
        <>
          <TextField label={t("presetActionName")} value={name} onChange={setName} />
          <Button
            label={t("createPreset")}
            disabled={busy || !name.trim()}
            onPress={() => apply({ kind: "createPreset", deckId, name })}
          />
          <Button
            label={t("duplicatePreset")}
            disabled={busy || !name.trim()}
            onPress={() => apply({ kind: "duplicatePreset", id: preset.id, deckId, name })}
          />
          <Button
            label={t("renamePreset")}
            disabled={busy || !name.trim() || name.trim() === preset.fields.name.value}
            onPress={() => apply({ kind: "updatePreset", id: preset.id, patch: { name } })}
          />
          <Button
            label={t("deletePreset")}
            destructive
            disabled={busy || isDefaultPreset(preset)}
            onPress={() =>
              Alert.alert(t("deletePreset"), t("deletePresetConfirm"), [
                { text: t("cancel"), style: "cancel" },
                {
                  text: t("deletePreset"),
                  style: "destructive",
                  onPress: () => apply({ kind: "deletePreset", id: preset.id }),
                },
              ])
            }
          />
        </>
      )}
    </View>
  );
}
