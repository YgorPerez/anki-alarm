import { useQueryClient } from "@tanstack/react-query";
import type { Collection } from "@app/core";
import { Effect } from "effect";
import { localData } from "./database.ts";

/** Persist under the screen's existing action lock, then refresh that screen's session query. */
export function useStudyAnnotationChange(
  guarded: (operation: () => Promise<void>) => Promise<void>,
  refresh: () => Promise<unknown>,
) {
  const client = useQueryClient();
  return (command: (c: Collection) => void) =>
    guarded(async () => {
      await Effect.runPromise(localData((data) => data.changeCollection(command)));
      await Promise.all([refresh(), client.invalidateQueries({ queryKey: ["collection"] })]);
    });
}
