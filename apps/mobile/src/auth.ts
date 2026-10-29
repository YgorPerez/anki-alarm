// Sign-in on the phone (docs/adr/0007-better-auth.md): Android's Google account picker returns an
// ID token, and better-auth's Expo client trades it for a session kept in SecureStore. The sync
// client sends that session's cookie.
import { expoClient } from "@better-auth/expo/client";
import { AccountFailed } from "@app/client-data";
import { makeSyncClient } from "@app/contracts";
import { GoogleSignin, isSuccessResponse } from "@react-native-google-signin/google-signin";
import { createAuthClient } from "better-auth/client";
import { Effect } from "effect";
import * as SecureStore from "expo-secure-store";

import type { Account, AccountUser } from "./sync.ts";

/**
 * Set at build time (docs/release.md › Sync and sign-in). Without them sign-in is off. Expo inlines
 * `process.env.EXPO_PUBLIC_*` only in dot notation.
 */
const SYNC_URL = process.env.EXPO_PUBLIC_SYNC_URL;
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

const user = (data: { user: { id: string; email: string } } | null | undefined) =>
  data ? { id: data.user.id, email: data.user.email } : null;

/** A call to Google's picker or better-auth, failing as `AccountFailed`. */
const google = <A>(message: string, call: () => Promise<A>) =>
  Effect.tryPromise({
    try: call,
    catch: (cause) =>
      new AccountFailed({ message: cause instanceof Error ? cause.message : message, cause }),
  });

function googleAccount(baseURL: string, webClientId: string): Account {
  const auth = createAuthClient({
    baseURL,
    plugins: [
      expoClient({ scheme: "anki-alarm", storagePrefix: "anki-alarm", storage: SecureStore }),
    ],
  });
  GoogleSignin.configure({ webClientId });
  return {
    current: google("Session check failed", async () => {
      const { data } = await auth.getSession();
      return user(data);
    }),
    signIn: google("Sign-in failed", async (): Promise<AccountUser | null> => {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const picked = await GoogleSignin.signIn();
      if (!isSuccessResponse(picked)) return null;
      const token = picked.data.idToken;
      if (!token) throw new Error("Google returned no ID token");
      const { data, error } = await auth.signIn.social({ provider: "google", idToken: { token } });
      if (error || !data || !("user" in data)) throw new Error(error?.message ?? "Sign-in failed");
      return user(data);
    }),
    signOut: google("Sign-out failed", async () => {
      await auth.signOut();
      await GoogleSignin.signOut();
    }),
    client: Effect.flatMap(
      google("Session cookie unreadable", async () => auth.getCookie()),
      (cookie) =>
        makeSyncClient({
          baseUrl: baseURL,
          headers: (): Record<string, string> => (cookie ? { cookie } : {}),
        }),
    ),
  };
}

/** The phone's account, or null in a build without a sync server. */
export const phoneAccount: Account | null =
  SYNC_URL && GOOGLE_WEB_CLIENT_ID ? googleAccount(SYNC_URL, GOOGLE_WEB_CLIENT_ID) : null;
