// Sign-in on the web (docs/adr/0007-better-auth.md): better-auth's redirect to Google and back. The
// session cookie belongs to the sync Worker's origin; the browser sends it with each request there
// (`credentials: "include"`), from this tab and from the database Worker that syncs.
import { AccountFailed, type Account, type AccountUser } from "@app/client-data";
import { createAuthClient } from "better-auth/client";
import { Effect, Option } from "effect";

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

/** A better-auth call, failing as `AccountFailed`. */
const call = <A>(message: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new AccountFailed({ message: cause instanceof Error ? cause.message : message, cause }),
  });
const failed = (error: { message?: string | undefined } | null, message: string) =>
  new AccountFailed({ message: error?.message ?? message });

function googleAccount(baseURL: string): Account {
  const auth = createAuthClient({ baseURL, fetchOptions: { credentials: "include" } });
  const devSignIn = Effect.gen(function* () {
    const email = window.prompt("Dev sign-in: e-mail");
    if (!email) return null;
    const { data, error } = yield* call("Sign-in failed", () =>
      auth.signIn.social({ provider: "google", idToken: { token: devIdToken(email) } }),
    );
    if (error || !data || !("user" in data)) return yield* failed(error, "Sign-in failed");
    return remember(userOf(data));
  });
  // Google, then the Worker's callback, then back to this page signed in: this tab never resumes.
  const redirect = Effect.gen(function* () {
    const { error } = yield* call("Sign-in failed", () =>
      auth.signIn.social({
        provider: "google",
        callbackURL: window.location.href,
        errorCallbackURL: window.location.href,
      }),
    );
    if (error) return yield* failed(error, "Sign-in failed");
    return yield* Effect.never;
  });
  return {
    current: Effect.gen(function* () {
      const result = yield* call("Session check failed", () => auth.getSession()).pipe(
        Effect.option,
      );
      // Unreachable, or no status: the request never got to the Worker (offline). The session
      // may still be fine.
      if (Option.isNone(result)) return remembered();
      const { data, error } = result.value;
      if (error) {
        if (!error.status) return remembered();
        return yield* failed(error, "Session check failed");
      }
      return remember(userOf(data));
    }),
    signIn: Effect.suspend(() => (DEV_SIGN_IN ? devSignIn : redirect)),
    signOut: Effect.suspend(() => {
      remember(null);
      return Effect.asVoid(call("Sign-out failed", () => auth.signOut()));
    }),
  };
}

/** The web's account, or null in a build without a sync server. */
export const webAccount: Account | null = SYNC_URL ? googleAccount(SYNC_URL) : null;
