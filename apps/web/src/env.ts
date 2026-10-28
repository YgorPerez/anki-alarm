// Build-time settings (docs/release.md › Sync and sign-in). Without VITE_SYNC_URL the web runs
// offline only and says sync is unavailable.

/** The sync Worker's origin, e.g. `https://sync.example.com`. */
export const SYNC_URL: string | undefined = import.meta.env["VITE_SYNC_URL"] || undefined;
/**
 * "1" in local builds against a dev Worker (`DEV_SIGN_IN`): sign-in asks for an e-mail and sends an
 * unsigned ID token instead of going to Google. Playwright's journeys use it.
 */
export const DEV_SIGN_IN = import.meta.env["VITE_DEV_SIGN_IN"] === "1";
