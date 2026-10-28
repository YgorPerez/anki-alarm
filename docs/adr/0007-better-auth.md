# better-auth for sign-in

Sign-in is better-auth, mounted in the sync Worker on D1 through its drizzle adapter, with Google
as the only provider. It replaces the wave design, where the Worker checked Google's ID token and
issued its own session token: better-auth does the same checks and brings sessions, revocation and
cookies we would otherwise write and test ourselves. Decided in the 2026-10-28 stack grilling.

- The phone keeps Android's Google account picker and signs in with the ID token it returns
  (better-auth's ID-token sign-in, through its Expo client). The web uses Google's redirect sign-in.
- The sync API in `packages/contracts` requires a better-auth session. Its routes sit beside the
  better-auth routes in the same Worker.
- Accounts and timing (first sign-in merges, sign-out keeps local data) stay as in ADR 0001.

## Considered options

- **The wave design.** No new dependency, but session handling would be ours to keep.
