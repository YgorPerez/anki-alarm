// uniwind reads React Native internals the stand-in doesn't have. Tests don't assert on theme colors.
import type { ReactNode } from "react";

export const useResolveClassNames = () => ({ color: "#000000" });
export const ScopedTheme = ({ children }: { children: ReactNode }) => children;
