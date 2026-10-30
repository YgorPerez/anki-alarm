import { useState } from "react";
import { Modal, Pressable, FlatList, Text, View } from "react-native";
import type { Locale } from "@app/core";
import { copy } from "./copy.ts";

export type StudyMenuItem = {
  id: string;
  label: string;
  disabled?: boolean;
  onPress: () => void;
};

/** Card actions supplied by the owning screen. An empty list hides the trigger. */
export function StudyMenu({
  items,
  locale,
  busy = false,
}: {
  items: readonly StudyMenuItem[];
  locale: Locale;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const t = copy(locale);
  if (!items.length) return null;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("studyActions")}
        disabled={busy}
        onPress={() => setOpen(true)}
        className="min-h-12 min-w-12 items-center justify-center"
      >
        <Text className="text-body text-foreground">⋮</Text>
      </Pressable>
      <Modal visible={open} transparent onRequestClose={() => setOpen(false)}>
        <View className="flex-1 justify-end bg-background p-4">
          <FlatList
            className="grow-0 rounded-lg bg-surface"
            data={items}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                disabled={busy || item.disabled}
                className="min-h-12 justify-center px-4 py-3"
                onPress={() => {
                  setOpen(false);
                  item.onPress();
                }}
              >
                <Text className="text-body text-foreground">{item.label}</Text>
              </Pressable>
            )}
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => setOpen(false)}
            className="min-h-12 items-center justify-center"
          >
            <Text className="text-body text-foreground">{t("cancel")}</Text>
          </Pressable>
        </View>
      </Modal>
    </>
  );
}
