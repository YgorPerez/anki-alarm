import { useState, type ReactNode } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import type { Locale } from "@app/core";
import { regular } from "./fonts.ts";
import { copy } from "./copy.ts";

/** One menu for card actions, including Duplicate and Skip/Undo skip. */
export function AlarmCardMenu({
  name,
  locale,
  items,
  children,
  onPress,
}: {
  name: string;
  locale: Locale;
  items: readonly { label: string; onPress: () => void; destructive?: boolean }[];
  children: ReactNode;
  onPress: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={name}
        accessibilityHint={items.length ? copy(locale)("moreOptionsHint") : undefined}
        accessibilityActions={
          items.length ? [{ name: "longpress", label: copy(locale)("moreOptions") }] : []
        }
        onAccessibilityAction={({ nativeEvent }) => {
          if (nativeEvent.actionName === "longpress") setOpen(true);
        }}
        onLongPress={items.length ? () => setOpen(true) : undefined}
        onPress={onPress}
        className="min-h-12 min-w-0 flex-1 gap-1"
      >
        {children}
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
                <Text
                  style={regular}
                  className={
                    item.destructive ? "text-body text-destructive" : "text-body text-foreground"
                  }
                >
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
