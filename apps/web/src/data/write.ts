import type { CollectionCommand } from "@app/core";

import { queryClient } from "#/query.ts";

import { webData } from "./client.ts";
import type { Args, Kind, Output } from "./protocol.ts";

/** A write, then every query read again, so the screen shows what committed. */
export async function write<K extends Kind>(kind: K, ...args: Args<K>): Promise<Output<K>> {
  const result = await webData().request(kind, ...args);
  await queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "storage-error" });
  return result;
}

/** An editing command (Core's `runCommand`); resolves with the id of what it created. */
export const change = (command: CollectionCommand) => write("change", command);
