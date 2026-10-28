import type { CollectionState, Settings, ThemeChoice } from "@app/core";
import type { PendingChange } from "@app/client-data";

// Commands cross tabs as data. Never send individual transaction statements across this boundary.
export type Operation =
  | { kind: "settings" }
  | { kind: "setTheme"; patch: Partial<ThemeChoice> }
  | { kind: "collection" }
  | { kind: "pendingChanges" };
export type Result = Settings | CollectionState | PendingChange[];
export type Request = { type: "request"; id: string; leader: string; operation: Operation };
export type Response = { type: "response"; id: string; result?: Result; error?: string };
export type Message =
  | Request
  | Response
  | { type: "discover" }
  | { type: "leader"; id: string }
  | { type: "changed" };
