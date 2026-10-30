import type { ReactNode } from "react";
import { PanResponder, View } from "react-native";

/** Claim horizontal drags only; ordinary card taps and list scrolling stay native. */
export function SwipeAlarm({
  id,
  onDelete,
  children,
}: {
  id: string;
  onDelete: () => void;
  children: ReactNode;
}) {
  const responder = PanResponder.create({
    onMoveShouldSetPanResponder: (_event, { dx, dy }) =>
      Math.abs(dx) > 20 && Math.abs(dx) > Math.abs(dy) * 2,
    onPanResponderRelease: (_event, { dx, dy }) => {
      if (Math.abs(dx) >= 96 && Math.abs(dx) > Math.abs(dy) * 2) onDelete();
    },
  });
  return (
    <View testID={`swipe-alarm-${id}`} {...responder.panHandlers}>
      {children}
    </View>
  );
}
