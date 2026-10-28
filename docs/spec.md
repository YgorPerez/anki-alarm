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
- **Web**: the full study client and editor. It never rings alarms.

## Repository and stack

A pnpm monorepo on GitHub under `YgorPerez`, driven by Vite+ (`vp check`, `vp lint`, `vp fmt`,
`vp test`), as in pesquisa-relacionamentos.

| Path            | What                                                                                                                                                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/mobile`   | Expo + React Native, react-native-reusables on uniwind (Tailwind 4), expo-sqlite + drizzle, Effect for services. A local Expo module in Kotlin (`modules/alarm-native`) for alarms, audio, TTS and AnkiDroid.                |
| `apps/web`      | TanStack Start/Router/Query, shadcn on Base UI (`@base-ui/react`), Tailwind 4, `@shadcn/lint`, Storybook, Vitest, Playwright. Deployed to Cloudflare Workers.                                                                |
| `apps/sync`     | Cloudflare Worker with D1 (data) and R2 (media), as in wave's `apps/sync`.                                                                                                                                                   |
| `packages/core` | Every decision-heavy rule, with **zero runtime dependencies** except `ts-fsrs`: log replay, session and dismiss rules, snooze cost, card picking, daily limits, `.apkg` model, template rendering, stats, alarm time math. |

`packages/core` uses erasable TypeScript only and is tested through its public API. The apps stay
thin: they wire Core to storage, native modules and the screen.

Shared checks across the repo: oxlint (through `vp lint`), fallow, react-doctor. The web adds
`@shadcn/lint` and story tests.

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
  needs sign-in.
- Sign-in follows wave: Android's Google account picker on the phone, Google sign-in on the web; the
  Worker checks the ID token and issues its own session token.
- Sync is push and pull of changes since a cursor: notes, note types, decks, deck options, alarms
  and reviews, against a per-user server sequence. Notes and settings merge field by field,
  last-write-wins by hybrid logical clock; the Worker resolves on push. Reviews never conflict: both
  sides append, and replay settles the card. Deletes are tombstones and beat edits.
- Media goes to R2, keyed by content hash, so the same file is stored once. Clients upload a file
  before the records that reference it. The phone keeps a local copy of every file its decks use,
  so an alarm never waits on the network.
- Ids, imports, linked decks, sign-in and sign-out, and when sync runs: see
  `docs/adr/0001-sync-protocol.md`.

## Import and export

- `.apkg` import on the phone and on the web, through one parser in Core. It reads the legacy
  format and the current one (`anki21b`, zstd-compressed). It brings note types, notes, decks, deck
  options, media and the review history (`revlog`), which becomes imported reviews.
- `.apkg` export of any deck, with its scheduling, so nothing is locked in.

## AnkiDroid

AnkiDroid decks become the app's own decks. The app schedules them with FSRS like any other deck.

- **Import** reads note types, notes, cards and decks through AnkiDroid's ContentProvider API
  (`FlashCardsContract`) and keeps AnkiDroid's note and card ids on each one. That makes it a
  **linked deck**.
- **Pull** (on demand, from the deck): new notes and edited fields come in. For each linked card
  whose AnkiDroid review is newer than our last review of it, the app records an imported review
  from AnkiDroid's state, and replay folds it in.
- **Sync back** (on demand, plus an optional auto sync after each alarm session): each review done
  in the app since the last sync is sent to AnkiDroid as an answer with the same grade and time
  taken, so AnkiDroid reschedules with its own scheduler and keeps a real history. AnkiDroid's API
  can't write due dates or memory state directly; only answers, bury, suspend and moving decks. The
  two schedules can drift a little when the FSRS parameters differ; that's accepted.
- Needs AnkiDroid installed and its API permission granted. Without it, the AnkiDroid screens say so
  and the rest of the app works.

## Study

The same study flow on the phone and the web: show the front, reveal the back, grade. An **alarm
session** is a special mode of it on the phone.

- Normal study follows the deck options and daily limits.
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

### Ringing

- Scheduled as exact alarms with `AlarmManager.setAlarmClock`, so they show as the next alarm in
  the system and ignore Doze. Re-armed after reboot, time change, time zone change and app update.
- At ring time a foreground service starts the sound on the alarm audio stream (so it plays in
  silent and Do Not Disturb), starts vibration, and opens the alarm screen as a full-screen intent
  over the lock screen. The volume ramps up over the alarm's ramp time.
- Leaving the alarm screen before dismissal brings the sound back at full volume after about 10
  seconds and offers the way back. If the app is killed, the service restarts and rings again. A
  reboot mid-session re-rings at boot.

### The alarm session

- Opening the alarm screen starts the session. The sound drops to a low level while you answer and
  comes back at full volume if no answer comes for a while.
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
device's TTS otherwise, in the language of the deck (pt-BR by default). The sound sits under it at a
low level.

### Snooze

When allowed, snooze silences the alarm for its snooze length. Each snooze adds a fixed number of
cards (2 by default) to that alarm's next ring, and snoozes stop being offered at the cap.

### Awake check

When on, the awake check starts a delay after dismissal (5 minutes by default). A full-screen prompt
shows one card. Answering it (any grade, as a normal review) ends it. With no answer in 60 seconds,
the alarm rings again with a fresh session.

## Stats

The full Anki-style set on the phone and the web, computed in Core from the review log: reviews per
day, the future due forecast, retention (true retention table), intervals, card counts by state,
hourly breakdown, FSRS stability, difficulty and retrievability distributions.

Plus wake-up stats: per alarm and overall, time from ring to dismissal, snoozes, cards needed, and
awake check passes and failures.

## Design

To be decided with the Impeccable skill: a `DESIGN.md` with one set of tokens, used by the phone
(uniwind CSS variables) and the web (shadcn CSS variables).

## Out of scope for the first release

- iOS.
- FSRS parameter optimization.
- Editing note types on the phone.
- AnkiWeb sync.
- Play Store release.
