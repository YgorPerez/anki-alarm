import type { LucideIcon } from "lucide-react-native";
import Flag from "lucide-react-native/icons/flag";
import EllipsisVertical from "lucide-react-native/icons/ellipsis-vertical";
import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Locale } from "@app/core";
import { copy } from "./copy.ts";
import { regular } from "./fonts.ts";
import { ThemedIcon } from "./icons.tsx";

export type StudyMenuItem = {
  id: string;
  label: string;
  disabled?: boolean;
  onPress: () => void;
} & (
  | { icon: LucideIcon; flag?: undefined }
  /** One of Anki's seven flags, drawn in its own color in the row at the top of the sheet. */
  | { flag: { color: string; selected: boolean }; icon?: undefined }
);

/** Card actions supplied by the owning screen. An empty list hides the trigger. */
export function StudyMenu({
  items,
  locale,
  busy = false,
  onOpenChange,
}: {
  items: readonly StudyMenuItem[];
  locale: Locale;
  busy?: boolean;
  onOpenChange?: ((open: boolean) => void) | undefined;
}) {
  const [open, setOpenState] = useState(false);
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };
  const insets = useSafeAreaInsets();
  const t = copy(locale);
  if (!items.length) return null;
  const take = (item: StudyMenuItem) => {
    setOpen(false);
    item.onPress();
  };
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("studyActions")}
        disabled={busy}
        onPress={() => setOpen(true)}
        className="min-h-12 min-w-12 items-center justify-center rounded-pill"
      >
        <ThemedIcon icon={EllipsisVertical} />
      </Pressable>
      <Modal
        transparent
        statusBarTranslucent
        animationType="slide"
        visible={open}
        onRequestClose={() => setOpen(false)}
      >
        <View className="flex-1 justify-end">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("cancel")}
            onPress={() => setOpen(false)}
            className="absolute inset-0 bg-black/50"
          />
          <View
            className="bg-surface pt-2"
            style={{
              maxHeight: "90%",
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              paddingBottom: insets.bottom + 8,
            }}
          >
            <ScrollView style={{ flexShrink: 1 }}>
              <View className="flex-row flex-wrap border-b border-border px-1 pb-2">
                {items.map(
                  (item) =>
                    item.flag && (
                      <Pressable
                        key={item.id}
                        accessibilityRole="button"
                        accessibilityLabel={item.label}
                        accessibilityState={{ selected: item.flag.selected }}
                        disabled={busy || item.disabled}
                        onPress={() => take(item)}
                        className={`min-h-12 min-w-12 flex-1 items-center justify-center rounded-pill ${item.flag.selected ? "bg-primary-tint" : ""}`}
                      >
                        <Flag size={24} color={item.flag.color} fill={item.flag.color} />
                      </Pressable>
                    ),
                )}
              </View>
              <View className="pt-2">
                {items.map((item) => {
                  if (!item.icon) return null;
                  const disabled = busy || item.disabled;
                  return (
                    <Pressable
                      key={item.id}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: Boolean(disabled) }}
                      disabled={disabled}
                      onPress={() => take(item)}
                      className="min-h-12 flex-row items-center gap-4 px-6 py-3 active:bg-border"
                    >
                      <ThemedIcon icon={item.icon} colorClassName="text-muted-foreground" />
                      <Text
                        style={regular}
                        className={
                          disabled
                            ? "shrink text-body text-muted-foreground"
                            : "shrink text-body text-foreground"
                        }
                      >
                        {item.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}
