import type { AccountState } from "@app/client-data";
import type { Locale } from "@app/core";

import { copy, type T } from "#/copy.ts";
import { webAccount } from "#/auth.ts";
import { useAccountState, webSync } from "#/sync.ts";
import { Button } from "#/ui/shadcn/button.tsx";

const syncLine = (state: Extract<AccountState, { kind: "signedIn" }>, locale: Locale, t: T) => {
  const { sync } = state;
  if (sync.kind === "syncing") return t("syncing");
  if (sync.kind === "failed") return t("syncFailed");
  if (sync.kind === "updateRequired") return t("updateRequired");
  if (sync.kind === "signedOut") return t("expired");
  if (sync.lastSyncedAt === null) return t("notSynced");
  const time = new Date(sync.lastSyncedAt).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return t("synced", { time });
};

/** Sign in with Google, the merge question, sync status and sign out. */
export function AccountPanel({ locale }: { locale: Locale }) {
  const t = copy(locale);
  const state = useAccountState();
  // The controller is made on first use, in the browser: event handlers only run there.
  if (!webAccount)
    return (
      <section aria-labelledby="account" className="flex flex-col gap-2">
        <h2 id="account" className="text-label font-bold">
          {t("account")}
        </h2>
        <p className="text-body text-muted-foreground">{t("syncUnavailable")}</p>
      </section>
    );
  return (
    <section aria-labelledby="account" className="flex flex-col items-start gap-3">
      <h2 id="account" className="text-label font-bold">
        {t("account")}
      </h2>
      {state.kind === "signedOut" && (
        <>
          <p className="text-body text-muted-foreground">{t("pitch")}</p>
          {state.busy ? (
            <p role="status" className="text-body">
              {t("signingIn")}
            </p>
          ) : (
            <Button size="lg" onClick={() => void webSync()?.signIn()}>
              {t("signIn")}
            </Button>
          )}
          {state.failed && (
            <p role="alert" className="text-body text-attention">
              {t("signInFailed")}
            </p>
          )}
        </>
      )}
      {state.kind === "confirm" && (
        <>
          <p className="text-body font-bold">{t("confirmTitle")}</p>
          <p className="text-body">{t("confirmBody", { email: state.user.email })}</p>
          <div className="flex flex-wrap gap-3">
            <Button size="lg" onClick={() => void webSync()?.confirm()}>
              {t("merge")}
            </Button>
            <Button size="lg" variant="outline" onClick={() => void webSync()?.signOut()}>
              {t("cancel")}
            </Button>
          </div>
        </>
      )}
      {state.kind === "signedIn" && (
        <>
          <p className="text-body">{t("signedInAs", { email: state.user.email })}</p>
          <p role="status" className="text-body text-muted-foreground">
            {syncLine(state, locale, t)}
          </p>
          <div className="flex flex-wrap gap-3">
            {state.sync.kind === "signedOut" ? (
              <Button size="lg" onClick={() => void webSync()?.signIn()}>
                {t("signIn")}
              </Button>
            ) : (
              <Button size="lg" variant="outline" onClick={() => webSync()?.syncNow()}>
                {t("syncNow")}
              </Button>
            )}
            <Button size="lg" variant="ghost" onClick={() => void webSync()?.signOut()}>
              {t("signOut")}
            </Button>
          </div>
          <p className="text-label text-muted-foreground">{t("signOutNote")}</p>
        </>
      )}
    </section>
  );
}
