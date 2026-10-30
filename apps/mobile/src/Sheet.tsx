import type { Locale } from "@app/core";
import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "./controls.tsx";
import { copy } from "./copy.ts";
import { bold } from "./fonts.ts";

/**
 * A bottom sheet: a 16px container over a scrim, closed by Done, a tap on the scrim or Back.
 * What's in it changes the screen under it as it's set.
 */
export function Sheet({
  title,
  visible,
  locale,
  onClose,
  children,
}: {
  title: string;
  visible: boolean;
  locale: Locale;
  onClose: () => void;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      transparent
      statusBarTranslucent
      animationType="slide"
      visible={visible}
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end">
        <Pressable
          accessible={false}
          importantForAccessibility="no"
          onPress={onClose}
          className="absolute inset-0 bg-black/50"
        />
        <View
          accessibilityViewIsModal
          className="gap-6 bg-background px-6 pt-6"
          style={{
            maxHeight: "90%",
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            paddingBottom: insets.bottom + 24,
          }}
        >
          <Text accessibilityRole="header" style={bold} className="text-body text-foreground">
            {title}
          </Text>
          <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          <Button label={copy(locale)("done")} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}
