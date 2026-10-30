import { useState, type ReactNode } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { regular } from "./fonts.ts";

/** A press target whose long press, or TalkBack action, opens a sheet of further actions. */
export function LongPressMenu({
  name,
  actionLabel,
  actionHint,
  items,
  children,
  onPress,
  onOpen,
  className,
}: {
  name: string;
  actionLabel: string;
  actionHint: string;
  items: readonly {
    label: string;
    accessibilityLabel?: string;
    onPress: () => void;
    destructive?: boolean;
  }[];
  children: ReactNode;
  onPress: () => void;
  onOpen?: () => void;
  className: string;
}) {
  const [open, setOpen] = useState(false);
  const openMenu = () => {
    setOpen(true);
    onOpen?.();
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={name}
        accessibilityHint={items.length ? actionHint : undefined}
        accessibilityActions={items.length ? [{ name: "longpress", label: actionLabel }] : []}
        onAccessibilityAction={({ nativeEvent }) => {
          if (nativeEvent.actionName === "longpress" && items.length) openMenu();
        }}
        onLongPress={items.length ? openMenu : undefined}
        onPress={onPress}
        className={className}
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
                accessibilityLabel={item.accessibilityLabel}
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
