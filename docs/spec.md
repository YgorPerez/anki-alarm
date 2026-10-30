# Spec

An alarm clock for Android that you turn off by reviewing flashcards. It is a full spaced-repetition
app too: Anki-compatible decks, FSRS-6 scheduling, study on the phone and on the web, and a link to
AnkiDroid.

The name is not decided. This spec says "the app"; code uses the `@app/*` scope until it's renamed
before the first release.

Words in **bold** on first use are defined in `GLOSSARY.md`.

## Audience and language

- Friends, through a sideloaded APK. No Play Store.
- The UI is Brazilian Portuguese first: pt-BR is the source copy and the default locale. English is
  a full translation kept in step. A string missing in English falls back to pt-BR.
- Code, docs, issues, PRs and commits are in English.

## Platforms

- **Android** now. **iOS** later, through AlarmKit (iOS 26+). Alarm scheduling sits behind one
  service interface, so iOS is a new implementation and nothing above it changes. On iOS, AlarmKit
  rings over the lock screen but can't hold dismissal until the cards are done; there the alarm
  rings, opens the session, and the **awake check** catches anyone who goes back to sleep.
- **Web**: the full study client and editor. It works offline like the phone and never rings
  alarms.

## Repository and stack

A pnpm monorepo on GitHub under `YgorPerez`, driven by Vite+ (`vp check`, `vp lint`, `vp fmt`,
`vp test`), as in pesquisa-relacionamentos.

| Path                     | What                                                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/mobile`            | Expo + React Native, react-native-reusables on uniwind (Tailwind 4), expo-sqlite through `packages/client-data`, Effect for services. Local Kotlin Expo modules: `modules/alarm-native` (alarms, audio, TTS) and `modules/ankidroid`. |
| `apps/web`               | TanStack Start/Router/Query, shadcn on Base UI (`@base-ui/react`), Tailwind 4, `@shadcn/lint`. sqlite-wasm in OPFS through `packages/client-data`, Serwist for the app shell. Deployed to Cloudflare Workers.                         |
| `apps/sync`              | Cloudflare Worker with D1 (data, through drizzle) and R2 (media). Implements `packages/contracts` with Effect's `HttpApiBuilder` and mounts better-auth.                                                                              |
| `packages/core`          | Every decision-heavy rule, with **zero runtime dependencies** except `ts-fsrs`: log replay, session and dismiss rules, snooze cost, card picking, daily limits, `.apkg` model, template rendering, stats, alarm time math.            |
| `packages/contracts`     | The sync API as an Effect HttpApi with Effect Schema: push, pull, media, metadata. The Worker implements it; both clients use the derived client. As in t3code's `packages/contracts`.                                                |
| `packages/client-data`   | What the phone and the web share below the screen: the drizzle schema and migrations, the outbox, and the push/pull engine, in Effect. The SQLite driver is injected. See `docs/adr/0006-shared-client-data.md`.                      |
| `packages/design-tokens` | CSS tokens for both apps.                                                                                                                                                                                                             |
| `packages/editing-ui`    | The copy both editors share (deck options, notes, card actions), with Core's limits in it.                                                                                                                                            |
| `packages/stats-ui`      | What both stats screens share: the copy, the sections in order, the retention table and wake-up tallies as text, and the host-free TanStack Charts definitions each app draws with its own host (React Native or DOM).                |

`packages/core` uses erasable TypeScript only and is tested through its public API. The apps stay
thin: they wire Core to storage, native modules and the screen. Effect is used everywhere outside
Core.

### Libraries

- TypeScript, Vite+, React Compiler on in both apps.
- Both apps: TanStack Query (reading local SQLite), Form, Virtual (long lists), Pacer (debounced
  search, autosave and sync) and Charts (stats; the React Native adapter is experimental, so only
  the drawing changes if it fails on the phone). zustand holds local UI state only, persisted (MMKV
  on the phone); data and synced settings live in SQLite.
- The web adds TanStack Devtools in development.
- Sign-in: better-auth. See `docs/adr/0007-better-auth.md`.

### Tests and checks

- Vitest everywhere. Test behaviour, not implementation. A test waits for the condition it checks
  and never sleeps.
- Each screen is tested with Testing Library (jsdom on the web, React Native Testing Library on the
  phone) against a fake sync API built from `packages/contracts` with `HttpApiBuilder`, as t3code's
  `apps/web/test`, so its responses follow the contract.
- Storybook on the web (with story tests) and on the phone.
- Playwright only for journeys that need the real system: session, several accounts, offline,
  layout. Maestro on an Android emulator for the alarm.
- Checks: oxlint (through `vp lint`), fallow, React Doctor, and `@shadcn/lint` on the web.
  Impeccable for visual polish.
- Violation ceiling: a new rule lands with zero violations, or with a per-file limit in a
  committed baseline that can only go down. CI fails when a file goes over its limit. This covers
  oxlint, fallow and React Doctor.
- CI on a pull request runs only the packages the diff affects and their dependents
  (`...[origin/main]`); main and tags run everything. Maestro runs on main and tags, and on a pull
  request only when it touches `apps/mobile` or `modules/`.

### Release

- A `vX.Y.Z` tag ships everything; merges to main don't. The Worker and web deploy to Cloudflare
  first.
- **OTA**: the runtime version is Expo's fingerprint. When the tag's fingerprint matches the latest
  APK's, CI publishes an EAS Update to the `production` channel. It applies on the next cold start,
  never during an alarm.
- **APK**: when the fingerprint changed, CI builds a signed APK with Gradle on GitHub Actions and
  attaches it to the GitHub release. The app offers a release's APK only when its versionCode is
  above the installed one, and installs it in-app.
- Sync is lockstep: a `SYNC_PROTOCOL` number in Core must match the Worker's, or sync pauses until
  the app updates.
- Details: `docs/adr/0002-release-policy.md`.

## Data model

### Cards

The app keeps Anki's model so imported decks look and behave as they do in Anki:

- A **note type** has fields, one or more **card templates** (front and back) and CSS. Cloze note
  types make one card per cloze number.
- A **note** holds field values. Each template (or cloze number) gives one **card**.
- A **deck** holds cards and has **deck options**: daily new and review limits, desired retention,
  FSRS parameters, learning steps.
- Media files (images, audio) are referenced from fields by file name.

Core renders a card side from its template, fields and CSS to an HTML document. The phone shows it
in a WebView; the web shows it in the page. Card audio (`[sound:…]`) plays on both.

### The review log

Every answer is a **review**: an immutable event with its own id (UUIDv7), the card id, the grade
(Again, Hard, Good, Easy), the time it was answered, the time taken and its **origin** (phone, web,
AnkiDroid import, alarm session). Reviews are only ever appended. Undo appends a **void** for the
review, and replay skips voided reviews.

A card's **memory state** (stability, difficulty, due date, learning step) is not stored as truth.
Core rebuilds it by replaying the card's reviews in answer-time order through FSRS with the deck's
options. Caches of the result are fine; the log is what syncs.

### Scheduling

- FSRS-6 through `ts-fsrs`, with its default parameters.
- Per-user parameter optimization is a later feature, once there is enough review history. The
  schema keeps everything the optimizer needs (the full log with grades and times).

## Sync

- The phone works fully offline with no account. Signing in with Google turns sync on. The web
  needs sign-in once, then works offline like the phone: its data is a local SQLite database and it
  queues changes in the same outbox.
- Sign-in is better-auth on the Worker: Android's Google account picker sends its ID token on the
  phone, Google sign-in on the web. See `docs/adr/0007-better-auth.md`.
- Sync is push and pull of changes since a cursor: notes, note types, decks, deck options, alarms
  and reviews, against a per-user server sequence. Notes and settings merge field by field,
  last-write-wins by hybrid logical clock; the Worker resolves on push. Reviews never conflict: both
  sides append, and replay settles the card. Deletes are tombstones and beat edits.
- Media goes to R2, keyed by content hash, so the same file is stored once. Clients upload a file
  before the records that reference it. The phone and the web keep a local copy of every file
  their decks use (the web in OPFS), so an alarm or an offline session never waits on the network.
- Ids, imports, linked decks, sign-in and sign-out, and when sync runs: see
  `docs/adr/0001-sync-protocol.md`.

## Import and export

- `.apkg` import on the phone and on the web, through one parser in Core. It reads the legacy
  format and the current one (`anki21b`, zstd-compressed). It brings note types, notes, decks, deck
  options, media and the review history (`revlog`), which becomes imported reviews.
- `.apkg` export of any deck, with its scheduling, so nothing is locked in. It writes the legacy
  format (`collection.anki21`) with the deck's subdecks, media, review history and each card's FSRS
  memory state; forgets and set due dates become Anki's manual revlog entries. Anki keeps the
  schedule only when "Import any learning progress" and "Import deck presets" are ticked, and a
  profile that already has the notes doesn't update their schedule; the deck screen says so. The
  app's own records carry their ids (note guid, a JSON key on note types, decks and presets), so
  importing the file back, here or after a trip through Anki, finds the same records and reviews.

## AnkiDroid

AnkiDroid decks become the app's own decks. The app schedules them with FSRS like any other deck.

- **Import** reads note types, notes, cards and decks through AnkiDroid's ContentProvider API
  (`FlashCardsContract`) and keeps AnkiDroid's note and card ids on each one. That makes it a
  **linked deck**, owned by the phone that linked it. Subdecks come along. Each reviewed card
  starts from a **snapshot** of AnkiDroid's state, since the API has no review history. Records
  take the same import ids as `.apkg` import, so linking again updates instead of duplicating.
- **Media** can't come through the API: the AnkiDroid screen asks for an `.apkg` export of the
  deck and stores its images and audio.
- **Pull** (on demand, from the deck) always runs a sync back first. Then new notes and cards and
  edited fields come in (a field takes AnkiDroid's value when its mod time is newer than our
  edit), and suspension follows AnkiDroid. For each linked card AnkiDroid reviewed since the phone
  last saw it (its `reps` went up), the app appends a snapshot timed at that review, and replay
  adopts it.
- **Sync back** (on demand from the deck, plus an auto sync after each alarm session, on by default
  and turned off per phone): every review of a linked card not sent yet, from any origin, goes to
  AnkiDroid in answer-time order as an answer with the same grade and time taken, so AnkiDroid
  reschedules with its own scheduler and keeps a real history. AnkiDroid stamps each answer with
  the time of the sync and caps the time taken at its deck's limit. Each answer is checked by
  reading the card back, since the API reports success either way. Answers for cards suspended or
  buried in AnkiDroid wait (answering would unsuspend them); answers for cards AnkiDroid deleted are
  dropped. A card AnkiDroid reviewed since we last saw it gets its snapshot before our answers go.
  The phone keeps what it sent and the `reps` it last saw locally; a phone that takes over a linked
  deck doesn't resend the reviews from before.
- AnkiDroid's API can't write due dates or memory state; only answers, bury, suspend and moving
  decks. A reset or set due date on a linked card stays in the app, the card screen says so, and
  AnkiDroid's next review of the card snapshots over it. The two schedules can drift a little when
  the FSRS parameters differ; that's accepted. Notes added in the app to a linked deck stay in the
  app.
- Needs AnkiDroid 2.24 or newer installed and its API permission granted. Without them, the
  AnkiDroid screens say so and the rest of the app works.

## Study

The same study flow on the phone and the web: show the front, reveal the back, grade. An **alarm
session** is a special mode of it on the phone.

- Normal study follows the deck options and daily limits.
- On the phone, alarm sessions, awake checks and Decks study give the card the width and remaining
  height of the screen, without a frame. The compact header shows time and progress on an alarm,
  with Snooze at the end; the awake check shows time, one-card progress and seconds remaining.
  Decks study shows a back link with the deck name and Undo. The big clock and alarm label stay on
  Start and other stages without a card.
- A native tap on the card reveals its back; dragging scrolls its HTML without revealing. The
  WebView keeps JavaScript disabled, preserves deck CSS and defaults to 28px text following system
  font scale. A screen reader gets the reveal hint and an accessibility action.
- The bottom strip reserves 64px for the reveal hint or four 64px grade pills. At large font scales
  the grades use two rows and the strip reserves both rows on front and back, including during the
  alarm's grade delay, so the card height stays fixed.
- The phone has a full editor: notes, decks, deck options. Editing note types (templates and CSS)
  is web only.

## Alarms

### An alarm

- Time, repeat days (or once), label, on/off.
- A deck (subdeck included) and **N**, the cards to get right.
- Sound: a bundled sound, the system ringtone picker, or an audio file on the device.
- Vibration on/off, and volume ramp time.
- **Read aloud** on/off.
- **Awake check** on/off, with its delay (5 minutes by default).
- Snooze on/off, snooze length, and the snooze cap.
- Skip next: a repeating, enabled alarm can skip one occurrence from its card's menu, and undo it.
  It rings again at the occurrence after; the skip syncs like the other properties and clears
  itself once the skipped time has passed. Decided in #78.

### Phone alarm editor

- No top bar. A fixed bottom bar holds neutral Cancelar / Cancel and solid Salvar / Save while the
  settings scroll above it. Saving turns the alarm on.
- Cancel and Android system Back leave immediately when the draft matches the opened alarm. With
  unsaved changes they ask "Descartar alterações?" / "Discard changes?". Keeping the draft stays
  in the editor; discarding leaves without saving. Back closes an open settings sheet first.
- Saved alarms show Pular o próximo / Skip next, Duplicar alarme / Duplicate alarm and Excluir
  alarme / Delete alarm at the end of the scroll. New alarms show none of these actions. Skip is
  available for enabled repeating alarms, can be undone, and is saved with the draft. Delete
  still asks for confirmation; Duplicate opens a new draft with the current settings.

### Ringing

- Scheduled as exact alarms with `AlarmManager.setAlarmClock`, so they show as the next alarm in
  the system and ignore Doze. Re-armed after reboot, time change, time zone change and app update.
- At ring time a foreground service starts the sound on the alarm audio stream (so it plays in
  silent and Do Not Disturb), starts vibration, and opens the alarm screen as a full-screen intent
  over the lock screen. The volume ramps up over the alarm's ramp time.
- Leaving the alarm screen before dismissal brings the sound and vibration back at full after about
  10 seconds and offers the way back. If the app is killed, the service restarts and rings again. A
  reboot mid-session re-rings at boot.
- A **ring** goes on until dismissal. It survives reboots with a PIN: before the first unlock a small
  native lock-screen activity shows the clock, the label and "Unlock to start", in the user's theme.
- An alarm missed while the phone was off rings at boot if it's 30 minutes late or less.
- An alarm that comes due during a ring is folded into it: the session keeps its deck and needs the
  larger N.
- Onboarding is one checklist screen: a title, a one-line intro and a small language toggle. Four
  **essential** settings come first: notifications, "Display over other apps" (needed to take over
  an unlocked phone), full-screen notifications and exact alarms. Below them, a visible but
  secondary "Recommended for your phone" section lists battery, background activity and the
  manufacturer's settings; it never gates anything.
  - Each row shows the setting's name and status, and tapping it opens the Android setting. Granted
    rows show a check and no text or button; tapping them does nothing. Status re-checks when the
    app returns to the foreground.
  - Settings the app can't read (Recents, Samsung, Motorola, some OEM switches) carry a one-line
    instruction and a "Done" checkbox, saved on the device.
  - The restricted-settings help (Android 15, sideloaded APK) appears under the overlay row only
    after the user comes back from the overlay setting without granting it.
  - Finish unlocks once the four essentials are granted. A small "Skip for now" link below it asks
    for confirmation ("Your alarms may not ring").
  - While an essential is missing after onboarding (skipped or revoked), Home shows a "Your alarms
    may not ring — Fix" banner that opens the checklist.
- Settings › Alarm reliability uses the same checklist, without Finish, plus the warning that
  force-stopping the app drops its alarms and the update offer.
- The module's API and who owns what: `docs/adr/0005-alarm-native-module.md`.

### The alarm session

- Tapping Start on the alarm screen starts the session. The sound and the vibration stop while you
  answer, and both come back at full if no answer comes for a while.
- Cards come from the alarm's deck in this order: due cards, then new cards, then reviews ahead
  (cards due soonest). FSRS handles early reviews.
- The back can only be graded after it's revealed, and the grade buttons appear a few seconds after
  the reveal. A card counts toward N only when rated Good or Easy. A card rated Again or Hard comes
  back later in the same session.
- Every answer is a normal review (origin: alarm session). Reviews count toward the deck's daily
  limits, but limits never stop an alarm: when they are reached, the session still gets its cards.
- After N cards right, the alarm is dismissed.

### Read aloud

When on, each card's front is read after it appears: the card's own audio if it has some, the
device's TTS otherwise, in the language of the deck (pt-BR by default). The alarm sound stays off
while it reads. The language is a deck property, set from the alarm editor; a subdeck without one
reads in its parent's.

### Snooze

When allowed, snooze silences the alarm for its snooze length. Each snooze adds a fixed number of
cards (2 by default) to that alarm's next ring, and snoozes stop being offered at the cap.

A new alarm allows snooze, 9 minutes long, twice per ring. Snooze is offered before Start and
during the session; the ring keeps its id and its progress, and rings again with N plus the cost
of every snooze so far. The snoozed screen shows when it rings again, with how many cards, and how
many snoozes are left, with Answer now to start the session early. An alarm that comes due while
snoozed is folded into the ring. Decided in #46.

### Awake check

When on, the awake check starts a delay after dismissal (5 minutes by default). A full-screen prompt
shows one card. Answering it (any grade, as a normal review) ends it. With no answer in 60 seconds,
the alarm rings again with a fresh session.

## Stats

The full Anki-style set on the phone and the web, computed in Core from the review log: reviews per
day, the future due forecast, retention (true retention table), intervals, card counts by state,
hourly breakdown, FSRS stability, difficulty and retrievability distributions.

Plus wake-up stats: per alarm and overall, time from ring to dismissal, snoozes, cards needed, and
awake check passes and failures. They come from the alarm journal, which syncs append-only like
reviews (ADR 0001), so the web shows them too.

## Design

`DESIGN.md` holds the visual system; `PRODUCT.md` the product context it serves. Decided in #3.

- **Look:** a plain black page with the card's words at full size. Lilac primary for action (Good,
  Start, progress), peach for attention (cards left, snooze cost, a card that came back), one hue
  per grade (Again rose, Hard yellow, Easy teal; Good is solid primary), the same in study and
  stats. Atkinson Hyperlegible on both apps.
- **Alarm screen:** always dark, one fixed layout: clock, progress segments, the card with no box,
  four grade pills at the thumb, snooze as a link apart from them. Cards render in Anki's night
  mode.
- **Light and dark:** the app follows the system or the user's choice; light mode is white with a
  deeper lilac.
- **Theme:** Settings › Theme recolors the backgrounds, primary, secondary and each grade, from
  swatches or a free picker. Core derives every token, fixes contrast to WCAG AA and warns about
  look-alike colors. The choice syncs, and the alarm, splash and app icon follow it. See
  `docs/adr/0004-configurable-theme.md`.
- **Tokens:** `packages/design-tokens` (`tokens.css` for both apps, `web.css` for the web), in the
  shape from `docs/research/design-tokens.md`, with a test that keeps them in step with DESIGN.md.
- The throwaway prototype is `prototypes/design/index.html`.

## Out of scope for the first release

- iOS.
- FSRS parameter optimization.
- Editing note types on the phone.
- AnkiWeb sync.
- Play Store release.
- Dynamic link-preview images (satori): there is no public page to preview.
