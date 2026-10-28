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
}

/** The phone's deep-link scheme (apps/mobile/app.config.ts). */
const APP_SCHEME = "anki-alarm://";

/** Test hooks only: the Worker passes none. */
export type AuthOverrides = Pick<GoogleOptions, "verifyIdToken">;

export const makeAuth = (env: Env, overrides: AuthOverrides = {}) =>
  betterAuth({
    database: drizzleAdapter(drizzle(env.DB, { schema }), { provider: "sqlite", schema }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    trustedOrigins: [
      APP_SCHEME,
      ...(env.TRUSTED_ORIGINS ?? "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ],
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        ...overrides,
      },
    },
    plugins: [expo()],
    telemetry: { enabled: false },
  });
export type Auth = ReturnType<typeof makeAuth>;
