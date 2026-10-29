import { useEffect, type ReactNode } from "react";
import { BackHandler } from "react-native";

/** Native rings and shown awake checks own the screen, including Android Back. */
export function NavigationGate({
  takeover,
  children,
}: {
  takeover: ReactNode;
  children: ReactNode;
}) {
  const active = Boolean(takeover);
  useEffect(() => {
    if (!active) return undefined;
    const handler = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => handler.remove();
  }, [active]);
  return takeover || children;
}
