import { createContext, useContext, type ReactNode } from "react";

export const RuntimeContext = createContext<{
  alarms: ReactNode;
  editor: (id: string, duplicate?: string) => ReactNode;
  reliability: (onExit: () => void) => ReactNode;
} | null>(null);
export function useRuntime() {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error("Routes must be inside App");
  return runtime;
}
