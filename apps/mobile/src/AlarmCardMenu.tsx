import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import type { Locale } from "@app/core";
import { bold, regular } from "./fonts.ts";
import { copy } from "./copy.ts";

/** One menu for card actions, including Duplicate and Skip/Undo skip. */
export function AlarmCardMenu({
  name,
  locale,
  items,
}: {
  name: string;
  locale: Locale;
  items: readonly { label: string; onPress: () => void }[];
}) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy(locale)("alarmMoreOptions", { alarm: name })}
        onPress={() => setOpen(true)}
        className="min-h-12 min-w-12 items-center justify-center rounded-pill"
      >
        <Text style={bold} className="text-body text-muted-foreground">
          ⋯
        </Text>
      </Pressable>
      <Modal transparent animationType="fade" visible={open} onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1 justify-end bg-black/50 p-4" onPress={() => setOpen(false)}>
          <View className="rounded-lg bg-surface p-2">
            {items.map((item) => (
              <Pressable
                key={item.label}
                accessibilityRole="button"
                onPress={() => {
                  setOpen(false);
                  item.onPress();
                }}
                className="min-h-12 justify-center rounded-pill px-4"
              >
                <Text style={regular} className="text-body text-foreground">
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
