import { mediaNotice, type AccountState } from "@app/client-data";
import type { Locale } from "@app/core";

import { copy, type T } from "#/copy.ts";
import { webAccount } from "#/auth.ts";
import { useAccountState, webSync } from "#/sync.ts";
import { Button } from "#/ui/shadcn/button.tsx";

const STATUS_COPY = {
  syncing: "syncing",
  failed: "syncFailed",
  updateRequired: "updateRequired",
  signedOut: "expired",
} as const;
/** What the last sync did, in a line. */
const syncLine = ({ sync }: Extract<AccountState, { kind: "signedIn" }>, locale: Locale, t: T) => {
  if (sync.kind !== "idle") return t(STATUS_COPY[sync.kind]);
  if (sync.lastSyncedAt === null) return t("notSynced");
  const at = new Date(sync.lastSyncedAt);
  return t("synced", {
    // react-doctor-disable-next-line react-doctor/no-locale-format-in-render -- Only the browser renders a signed-in state; the server renders loading.
    time: at.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
  });
};

/** What the last sync couldn't do with media files, if anything. */
const mediaLine = ({ media }: Extract<AccountState, { kind: "signedIn" }>, t: T) => {
  const notice = mediaNotice(media);
  return notice && t(notice.key, { count: String(notice.count) });
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
          {mediaLine(state, t) !== null && (
            <p className="text-body text-attention">{mediaLine(state, t)}</p>
          )}
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
