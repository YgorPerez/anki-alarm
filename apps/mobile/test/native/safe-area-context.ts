// react-native-safe-area-context reads the insets from a native module. Tests get none.
import type { ReactNode } from "react";

const insets = { top: 0, right: 0, bottom: 0, left: 0 };

export const useSafeAreaInsets = () => insets;
export const SafeAreaProvider = ({ children }: { children: ReactNode }) => children;
