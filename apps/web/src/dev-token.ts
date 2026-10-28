const base64url = (value: object) =>
  btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

/**
 * An unsigned Google ID token for `email`: only a local Worker with DEV_SIGN_IN accepts it. The
 * web's dev sign-in sends it, and so does the phone the journeys simulate.
 */
export const devIdToken = (email: string) =>
  `${base64url({ alg: "none" })}.${base64url({
    iss: "https://accounts.google.com",
    aud: "dev",
    sub: email,
    email,
    email_verified: true,
    name: email,
    exp: Math.floor(Date.now() / 1000) + 600,
  })}.`;
