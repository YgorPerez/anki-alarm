// Sign-in on the web (docs/adr/0007-better-auth.md): better-auth's redirect to Google and back. The
// session cookie belongs to the sync Worker's origin; the browser sends it with each request there
// (`credentials: "include"`), from this tab and from the database Worker that syncs.
import type { Account, AccountUser } from "@app/client-data";
import { createAuthClient } from "better-auth/client";

import { devIdToken } from "./dev-token.ts";
import { DEV_SIGN_IN, SYNC_URL } from "./env.ts";

/** The last signed-in user, so a reload without network still shows who is signed in. */
const CACHE_KEY = "account";
const remember = (user: AccountUser | null) => {
  try {
    if (user) localStorage.setItem(CACHE_KEY, JSON.stringify(user));
    else localStorage.removeItem(CACHE_KEY);
  } catch {
    /* Only a display cache. */
  }
  return user;
};
const remembered = (): AccountUser | null => {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
    if (
      typeof stored === "object" &&
      stored !== null &&
      "id" in stored &&
      "email" in stored &&
      typeof stored.id === "string" &&
      typeof stored.email === "string"
    )
      return { id: stored.id, email: stored.email };
  } catch {
    /* Unreadable: nobody. */
  }
  return null;
};

const userOf = (data: { user: { id: string; email: string } } | null | undefined) =>
  data ? { id: data.user.id, email: data.user.email } : null;

function googleAccount(baseURL: string): Account {
  const auth = createAuthClient({ baseURL, fetchOptions: { credentials: "include" } });
  return {
    async current() {
      let result;
      try {
        result = await auth.getSession();
      } catch {
        return remembered();
      }
      // No status: the request never reached the Worker (offline). The session may still be fine.
      if (result.error) {
        if (!result.error.status) return remembered();
        throw new Error(result.error.message ?? "Session check failed");
      }
      return remember(userOf(result.data));
    },
    async signIn() {
      if (DEV_SIGN_IN) {
        const email = window.prompt("Dev sign-in: e-mail");
        if (!email) return null;
        const { data, error } = await auth.signIn.social({
          provider: "google",
          idToken: { token: devIdToken(email) },
        });
        if (error || !data || !("user" in data))
          throw new Error(error?.message ?? "Sign-in failed");
        return remember(userOf(data));
      }
      // Google, then the Worker's callback, then back to this page signed in.
      const { error } = await auth.signIn.social({
        provider: "google",
        callbackURL: window.location.href,
        errorCallbackURL: window.location.href,
      });
      if (error) throw new Error(error.message ?? "Sign-in failed");
      return new Promise<never>(() => {});
    },
    async signOut() {
      remember(null);
      await auth.signOut();
    },
  };
}

/** The web's account, or null in a build without a sync server. */
export const webAccount: Account | null = SYNC_URL ? googleAccount(SYNC_URL) : null;
