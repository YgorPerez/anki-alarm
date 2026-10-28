// better-auth on D1 through drizzle, Google only (docs/adr/0007-better-auth.md). The phone signs
// in with the ID token from Android's account picker; the web uses Google's redirect.
import { expo } from "@better-auth/expo";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { GoogleOptions } from "better-auth/social-providers";
import { drizzle } from "drizzle-orm/d1";

import { schema } from "./schema.ts";

export interface Env {
  DB: D1Database;
  /** 32+ random bytes, base64. Every value here is a Worker secret (docs/release.md). */
  BETTER_AUTH_SECRET: string;
  /** The Worker's public origin, e.g. `https://sync.example.com`. */
  BETTER_AUTH_URL: string;
  /** The Google OAuth **web** client. Android's ID tokens are issued for it too. */
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /** Comma-separated origins allowed to sign in besides the app's scheme: the web app. */
  TRUSTED_ORIGINS?: string;
  /**
   * "1" accepts unsigned Google ID tokens, for local journeys without an OAuth client. Honoured only
   * when BETTER_AUTH_URL is localhost; never set it on a deployed Worker.
   */
  DEV_SIGN_IN?: string;
}

/** The phone's deep-link scheme (apps/mobile/app.config.ts). */
const APP_SCHEME = "anki-alarm://";

/** Test hooks only: the Worker passes none. */
export type AuthOverrides = Pick<GoogleOptions, "verifyIdToken">;

/** The web app's origins: they may sign in and call the API from the browser (CORS). */
export const webOrigins = (env: Env) =>
  (env.TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
/** Dev sign-in: a local Worker that asked for it takes any well-formed ID token. */
const devOverrides = (env: Env): AuthOverrides =>
  env.DEV_SIGN_IN === "1" && LOCAL_HOSTS.has(new URL(env.BETTER_AUTH_URL).hostname)
    ? { verifyIdToken: async () => true }
    : {};

export const makeAuth = (env: Env, overrides: AuthOverrides = devOverrides(env)) =>
  betterAuth({
    database: drizzleAdapter(drizzle(env.DB, { schema }), { provider: "sqlite", schema }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    trustedOrigins: [APP_SCHEME, ...webOrigins(env)],
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        ...overrides,
      },
    },
    plugins: [expo()],
    // The web may live on another site than the Worker: its fetches send the session cookie only
    // when it is SameSite=None (which needs Secure, so https). Locally both are localhost.
    advanced: env.BETTER_AUTH_URL.startsWith("https:")
      ? { defaultCookieAttributes: { sameSite: "none", secure: true } }
      : {},
    telemetry: { enabled: false },
  });
export type Auth = ReturnType<typeof makeAuth>;
