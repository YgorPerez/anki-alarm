// The phone's account controller: client-data's `accountSync` over the phone's local database and
// a session whose cookie the phone sends itself (auth.ts).
import {
  accountSync,
  type AccountFailed,
  type AccountState,
  type Account as AnyAccount,
  type ClientData,
} from "@app/client-data";
import type { SyncClient } from "@app/contracts";
import { Effect } from "effect";
import { useSyncExternalStore } from "react";

export type { AccountState, AccountUser } from "@app/client-data";

/** The signed-in Google account and its session. The phone's is in auth.ts. */
export interface Account extends AnyAccount {
  /** The contract's client, carrying the session. */
  client: Effect.Effect<SyncClient, AccountFailed>;
}

type Data = ClientData["Service"];
/** The phone's local database, opened on first use (`localData`). */
type UseData = <A, E extends Error>(
  use: (data: Data) => Effect.Effect<A, E>,
) => Effect.Effect<A, E | Error>;

export function createSync({ account, data }: { account: Account; data: UseData }) {
  return accountSync({
    account,
    data: {
      syncAccount: data((d) => d.syncAccount),
      adoptAccount: (userId) => data((d) => d.adoptAccount(userId)),
      sync: Effect.flatMap(account.client, (client) => data((d) => d.sync(client))),
      subscribe: (listener) => {
        let unsubscribe: (() => void) | undefined;
        let disposed = false;
        // The database opens in the background; a listener added before then subscribes after.
        void Effect.runPromise(data((d) => Effect.succeed(d))).then((d) => {
          if (!disposed) unsubscribe = d.subscribe(listener);
        });
        return () => {
          disposed = true;
          unsubscribe?.();
        };
      },
    },
  });
}
export type Sync = ReturnType<typeof createSync>;

const loading: AccountState = { kind: "loading" };
const noSync = () => () => {};
const loadingState = () => loading;
/** The account's state; loading for a build without sync. */
export const useAccountState = (sync: Sync | null) =>
  useSyncExternalStore(
    sync?.subscribe ?? noSync,
    sync?.state ?? loadingState,
    sync?.state ?? loadingState,
  );
