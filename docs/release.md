# Releasing

ADR 0002 is the policy. `.github/workflows/release.yml` runs only on pushed `vX.Y.Z`
tags. Branch pushes and merges run checks without deploying. Versions use
`major * 10000 + minor * 100 + patch`; minor and patch must be between 0 and 99.
`v0.0.0`, prerelease tags and versions beyond Android's versionCode limit are rejected.

## Human setup before the first tag

Create a GitHub environment named `production`. Add these environment secrets:

| Secret                      | Value                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`      | Cloudflare token allowed to deploy both Workers and access their configured bindings. |
| `EXPO_TOKEN`                | Expo access token for the account that owns this EAS project.                         |
| `ANDROID_KEYSTORE_BASE64`   | Base64 encoding of the release keystore file.                                         |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password.                                                                    |
| `ANDROID_KEY_ALIAS`         | Release signing key alias.                                                            |
| `ANDROID_KEY_PASSWORD`      | Signing key password.                                                                 |

Keep an offline backup of the keystore and its passwords. Every future APK must use the same
signing key to install over an existing copy. No keystore or secret belongs in Git.
The workflow decodes the keystore into the runner's temporary directory and deletes it after Gradle.

Add these GitHub environment variables:

| Variable                     | Value                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID`      | Cloudflare account that hosts the web and sync Workers.                                 |
| `EXPO_PUBLIC_EAS_PROJECT_ID` | UUID of the EAS project, used in the embedded update URL. This is public configuration. |

In Expo, link the project to the intended account and slug (`anki-alarm`). Create the
`production` channel pointing to a `production` update branch. Set
`EXPO_PUBLIC_EAS_PROJECT_ID` in the EAS **production** environment to the same UUID as GitHub.
`eas update --environment production` must see the same native configuration as the APK build.
Use the checked-in EAS CLI via `pnpm exec eas` from `apps/mobile`; APK builds run on GitHub,
not EAS Build. A local dev client works without an EAS project id, with updates disabled.

Set up Cloudflare resources and any D1/R2 bindings required by the current sync implementation.
The checked-in deployment names are `app-sync` and `app-web`; change them before tagging if the
account already uses those names. Worker secrets for authentication belong in Cloudflare, separate
from the release workflow's secrets.

Restrict who can create release tags and use the production environment. The repository's automatic
GitHub token supplies release-upload access; do not create a personal GitHub token for CI.

## What a tag does

CI validates the tag, checks configuration, runs `vp check` and the tests, then deploys sync and web
in that order. It computes the Android fingerprint using Expo's fingerprint implementation.
GitHub release pages are paginated until the newest published, non-preview release with
`anki-alarm.apk` is found. Notes-only OTA releases are skipped.

The first release builds an APK. A changed fingerprint also builds one, through Expo prebuild and
Gradle `assembleRelease` with the release signing configuration. The release contains
`anki-alarm.apk` and `release-metadata.json` with `version`, `versionCode` and `fingerprint`.
Keep both assets: a missing metadata file on a previous APK release stops CI rather than guessing
that an OTA is compatible. An older or equal versionCode is rejected.

A matching fingerprint publishes an Android EAS Update to `production`; the GitHub release has
notes and no APK. It never publishes an OTA in the APK branch. Releases run serially and an existing
release tag cannot be republished. Do not move published tags.

Cloudflare deployments and EAS publication are separate operations. If a job fails after deployment,
inspect which steps completed before rerunning it. A failure after EAS publication but before the
GitHub release may require creating the notes-only release manually to avoid another OTA publication.
GitHub concurrency retains only one pending run; push one tag at a time and wait for completion.

## Phone behavior and later integration

`runtimeVersion` uses Expo's fingerprint policy. APKs listen to `production`. Updates check on load
and download in the background with a zero launch wait. There is no call to `reloadAsync`: downloaded
JS takes effect on the next cold start. No timer, resume handler, or alarm completion forces a reload.
See [Expo's download behavior](https://docs.expo.dev/eas-update/download-updates/).

Home checks the public GitHub releases API, skips OTA releases and offers an APK only if its
versionCode exceeds the installed native build version. The banner is dismissible. Accepting downloads
the APK into cache and opens Android's installer with a content URI and read permission. The user
must allow installs from this app; Android still asks for confirmation. Failures leave a retry action.

`UpdateOffer` belongs only on Home and, when implemented, Settings. Keep it out of study, ring,
alarm session and awake check screens. Those screens and Settings do not exist in the current shell;
verify their transitions when those tickets land. Do not replace the native installed version with
an OTA's JS version when deciding whether to offer an APK.

`SYNC_PROTOCOL` is exported by Core and imported by the Worker. Every sync request under `/sync`
carries it in `X-Sync-Protocol` (the contract's `makeSyncClient` adds it). The Worker answers a
mismatch with 426 and `{ "_tag": "UpdateRequired", "syncProtocol": n }`, which the client decodes as
`UpdateRequired`; metadata reports the Worker's protocol too. The phone then pauses sync, downloads an
available OTA without reloading, and Home keeps offering the APK. Alarms and local study keep working.
Bump Core's constant in the PR that changes the sync contract.

## Sync and sign-in

The sync Worker (`apps/sync`) runs better-auth on D1 with Google as the only provider
(docs/adr/0007-better-auth.md). Nothing below exists yet; the human creates it once.

1. **D1.** `pnpm --filter @app/sync exec wrangler d1 create app-sync`, then put the printed id in
   `apps/sync/wrangler.toml` (`database_id`, now a placeholder). The release workflow applies
   `apps/sync/migrations` with `wrangler d1 migrations apply app-sync --remote` before each deploy;
   the API token needs D1 edit permission.
   **R2.** `pnpm --filter @app/sync exec wrangler r2 bucket create app-sync-media` (the `MEDIA`
   binding in `wrangler.toml`). Media files live there under their SHA-256, once for every user,
   and are never deleted in this release. The deploy token needs R2 edit permission too.
2. **Google Cloud.** In one project's OAuth consent screen, create:
   - a **Web application** client. Its id is the audience of every ID token, the phone's included.
     Add the redirect URI `https://<sync host>/api/auth/callback/google` (the web's redirect sign-in).
   - an **Android** client for package `dev.ygorperez.ankialarm` with the SHA-1 of the release
     signing key (`keytool -list -v -keystore release.keystore`), plus one for the debug keystore
     to sign in from a development build. The Android clients need no secret and no file in the app.
3. **Worker secrets**, each with `pnpm --filter @app/sync exec wrangler secret put <NAME>`:

   | Secret                 | Value                                                                     |
   | ---------------------- | ------------------------------------------------------------------------- |
   | `BETTER_AUTH_SECRET`   | `openssl rand -base64 32`. Rotating it signs every session out.           |
   | `BETTER_AUTH_URL`      | The Worker's public origin, e.g. `https://sync.example.com`.              |
   | `GOOGLE_CLIENT_ID`     | The web client's id.                                                      |
   | `GOOGLE_CLIENT_SECRET` | The web client's secret.                                                  |
   | `TRUSTED_ORIGINS`      | The web app's origin(s), comma-separated. The phone's scheme is built in. |

4. **GitHub environment variables** (`production`), inlined into the phone's bundle at build time;
   set the same two in the EAS **production** environment so `eas update` bundles them too:

   | Variable                           | Value                                      |
   | ---------------------------------- | ------------------------------------------ |
   | `EXPO_PUBLIC_SYNC_URL`             | The Worker's public origin.                |
   | `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | The web client's id (not the Android one). |

A build without the two variables runs fully offline and says sync is unavailable. For local work,
put the five Worker values in `apps/sync/.dev.vars` (untracked), run
`wrangler d1 migrations apply app-sync --local` and `wrangler dev`, and start the phone with the two
`EXPO_PUBLIC_*` variables pointing at it. The Worker tests need none of this: they run on a local D1
and R2.

Adding Google Sign-In, SecureStore, expo-network, expo-linking, expo-constants and expo-web-browser
changed native code: the next release builds an APK, and a development client must be rebuilt.

## Undoing a bad OTA

Find the last good Android update group in Expo. With `EXPO_TOKEN` available locally, run
`bash scripts/release/rollback.sh LAST_GOOD_UPDATE_GROUP_ID`. This explicitly republishes that group
to `production`; it does not build an APK. Then fix forward with a new patch tag. Expo also has launch
crash recovery. A native regression needs a new APK signed with the original key.

## Validation before the first real release

The local tests exercise version parsing, APK selection, protocol rejection and the release entry
points with a fake GitHub transport. No release credentials are needed. Web build and Android JS
export can also run without credentials. Fingerprint generation can run locally with a placeholder
project UUID; changing only the tag must leave its hash unchanged.

A human must still verify deployment access, EAS publication, Gradle signing and installation using
the real production configuration. On Android, test unknown-source consent, upgrading an installed
APK, ignoring lower/equal versions, an OTA applying only after a cold start, offline launch, and an
alarm session continuing while an update downloads. No real release or keystore was created for #63.
