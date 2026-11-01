# AnkiDroid ContentProvider API: import, pull and sync back

Research for ticket #4. Sources are the AnkiDroid source (`ankidroid/Anki-Android`), the Anki Rust
backend it embeds (`ankitects/anki`), and the AnkiDroid API wiki. Line links point at:

- AnkiDroid `main` at [`ef558bc`](https://github.com/ankidroid/Anki-Android/tree/ef558bc06e5e63cb74001aac8f1650c09ea51f49)
  (2.26 alpha). Abbreviated **AD** below. The provider code that matters here behaves the same in
  the current stable release, `v2.25.3`. The diff to `main` is renames and a lazy cursor.
- Anki `26.05` at [`e64c6b1`](https://github.com/ankitects/anki/tree/e64c6b1aee3e8d668fb8bbe084beada8e070d985).
  This is the backend that AnkiDroid `v2.25.3` ships
  ([`libs.versions.toml` L73 at v2.25.3](https://github.com/ankidroid/Anki-Android/blob/v2.25.3/gradle/libs.versions.toml#L73):
  `0.1.68-anki26.05`). Abbreviated **Anki** below.

## Answer

**Import** works for note types (fields, templates, CSS, cloze or not), notes (fields, tags, guid,
mod time), cards (note id, ord, deck) and decks (name, id, options JSON). Media does not come
through: the API can't read files. Review history does not come through either: the API has no
revlog access.

**Pull** can bring in new and edited notes (compare `mod`) and each card's current scheduling state.
On AnkiDroid 2.24.0 and later that state includes reps, lapses, type, queue, due, interval, FSRS
stability, difficulty and last review time. It can't bring in individual reviews. You can see
_that_ a card was reviewed (reps went up, `last_review_time_secs` moved) and how many times, but
not the grades or the times of reviews before the last one.

**Sync back** works. It answers any card by note id and ord, due or not, through AnkiDroid's own
scheduler, and that writes a real revlog row. Limits:

- The review is stamped with the time of the sync, not the time the user answered.
- Time taken is capped by the AnkiDroid deck's "maximum answer seconds" (60 s by default).
- Answering a suspended or buried card puts it back in a study queue.
- Siblings are buried according to AnkiDroid's deck options.
- The call reports success even when the answer failed.

**Minimum AnkiDroid version: 2.24.0.** That release added the `cards` URI, card ids and all the
scheduling columns. Before it, sync back works (it is much older), but pull can't see whether a
card was reviewed at all.

### Proposed spec changes

1. **Require AnkiDroid 2.24.0+** for linked decks. Detect it from AnkiDroid's `versionCode`. The
   provider spec number is still `2` and doesn't change with these columns.
2. **Pull records a state snapshot, not a review.** The API has no grades and no history, so
   "records an imported review from AnkiDroid's state" can't be done faithfully. Change it to:
   for a linked card whose AnkiDroid `reps` is higher than the last value we saw, append one event
   (origin: AnkiDroid) at AnkiDroid's `last_review_time_secs`. The event carries AnkiDroid's
   stability, difficulty, interval, card type, and the reps and lapses deltas. Replay adopts that
   state as of that time instead of computing it from a grade. If a grade is needed for stats,
   infer it (Again if lapses went up or the card went back to learning or relearning, otherwise
   Good) and mark it as inferred. Stats should count the reps delta as reviews. This needs a
   Glossary entry ("snapshot") and a note in "The review log" that replay accepts snapshots.
3. **Initial import also has no history.** Either start linked cards from a snapshot (same as
   pull), or let the user export the deck from AnkiDroid as `.apkg` and import that, which brings
   full `revlog` and media, then link by note id.
4. **Media needs another route.** The API only _adds_ media to AnkiDroid. It never returns file
   contents. Proposal: the AnkiDroid import screen asks for an `.apkg` export of the deck (shared
   to the app from AnkiDroid). That file gives media and history, and the API is used only for
   pull and sync back afterwards. Without it, a linked deck has no images or audio, and pulled
   notes that reference new media show broken references.
5. **Sync back wording.** Replace "with the same grade and time taken" with: same grade; time
   taken capped by AnkiDroid's deck limit; answer time is the time of the sync. So sync back
   soon. Make the auto sync after each alarm session the default, and sync back pending reviews
   before a pull.
6. **Avoid re-importing our own answers.** After each sync-back answer, read the card back
   (`reps`, `last_review_time_secs`) and store it as the last seen AnkiDroid state. Pull compares
   against that, so a synced-back review isn't pulled in again as an AnkiDroid review. This is
   also how sync back checks that the answer happened, since the API returns success either way.
7. **Key linked cards by (AnkiDroid note id, ord)** and also store the AnkiDroid card id. Sync back
   addresses cards by note id and ord, not by card id.
8. **Suspended or buried in AnkiDroid.** Pull reads `queue`. Sync back skips cards with a negative
   queue (or the user chooses), because answering them unsuspends them.

## Detail

### Access and permission

- The provider is exported with authority `<package>.flashcards`, and AnkiDroid declares the
  permission `<package>.permission.READ_WRITE_DATABASE` with `protectionLevel="dangerous"`
  ([AD manifest L45-49](https://github.com/ankidroid/Anki-Android/blob/ef558bc06e5e63cb74001aac8f1650c09ea51f49/AnkiDroid/src/main/AndroidManifest.xml#L45-L49),
  [L631-639](https://github.com/ankidroid/Anki-Android/blob/ef558bc06e5e63cb74001aac8f1650c09ea51f49/AnkiDroid/src/main/AndroidManifest.xml#L631-L639)).
  `<package>` is `com.ichi2.anki`, or `com.ichi2.anki.A` and so on for parallel builds
  ([FlashCardsContract L99-111](https://github.com/ankidroid/Anki-Android/blob/ef558bc06e5e63cb74001aac8f1650c09ea51f49/api/src/main/java/com/ichi2/anki/FlashCardsContract.kt#L99-L111)).
- Because the permission is "dangerous", our app declares `<uses-permission>` for it and requests
  it at runtime like any other dangerous permission (`ActivityCompat.requestPermissions` with the
  string above). Every query, insert, update and delete checks the caller's permission
  ([CardContentProvider L282-284, L546-548, L1487-1492](https://github.com/ankidroid/Anki-Android/blob/ef558bc06e5e63cb74001aac8f1650c09ea51f49/AnkiDroid/src/main/java/com/ichi2/anki/provider/CardContentProvider.kt#L1487-L1492)).
  Without it, every call throws `SecurityException`.
- On Android 11+ the app needs `<queries><package android:name="com.ichi2.anki" /></queries>`,
  or resolving the provider fails with "Failed to find provider info"
  ([AnkiDroid API wiki](https://github.com/ankidroid/Anki-Android/wiki/AnkiDroid-API)).
- The API library itself warns about an "install order bug": the permission can be missing if our
  app was installed before AnkiDroid
  ([AddContentApi L232](https://github.com/ankidroid/Anki-Android/blob/ef558bc06e5e63cb74001aac8f1650c09ea51f49/api/src/main/java/com/ichi2/anki/api/AddContentApi.kt#L226-L236)).
  The AnkiDroid screens should check the grant on every visit, not once.
- If AnkiDroid's storage isn't set up yet (first run never finished), every call throws
  `IllegalStateException`
  ([CardContentProvider L266-273](https://github.com/ankidroid/Anki-Android/blob/ef558bc06e5e63cb74001aac8f1650c09ea51f49/AnkiDroid/src/main/java/com/ichi2/anki/provider/CardContentProvider.kt#L266-L273)).
- The provider advertises spec version `2` in its meta-data
  ([manifest L638](https://github.com/ankidroid/Anki-Android/blob/ef558bc06e5e63cb74001aac8f1650c09ea51f49/AnkiDroid/src/main/AndroidManifest.xml#L638)).
  That number dates from AnkiDroid 2.6
  ([AddContentApi L613-652](https://github.com/ankidroid/Anki-Android/blob/ef558bc06e5e63cb74001aac8f1650c09ea51f49/api/src/main/java/com/ichi2/anki/api/AddContentApi.kt#L613-L652))
  and did not change for the 2.24 additions, so feature detection has to use the app version.
- We don't need the `com.ichi2.anki:api` library. The contract is column-name strings and URIs,
  which `modules/alarm-native` can define itself.

### Version facts

| Feature                                                                                                                  | First release | Evidence                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------ | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Notes, note types, templates, decks, `schedule` (answer, bury, suspend)                                                  | 2.5 / 2.6     | [wiki](https://github.com/ankidroid/Anki-Android/wiki/AnkiDroid-API), spec v2 note above                                                                                                                                                                                                                               |
| `cards` search URI, `cards/<id>`, `_id` column                                                                           | 2.24.0        | [`d20fd89`](https://github.com/ankidroid/Anki-Android/commit/d20fd891a6ba823d9e868d2d8479a2a2c7b84858) (2026-01-23)                                                                                                                                                                                                    |
| `reps`, `lapses`, `type`, `queue`, `due`, `interval`, `left`, FSRS stability, difficulty, decay, `last_review_time_secs` | 2.24.0        | [`570c05a`](https://github.com/ankidroid/Anki-Android/commit/570c05accde169cfadff368290f52d576d3f4f5b), [`f946f26`](https://github.com/ankidroid/Anki-Android/commit/f946f268939dceb8ce87e998cbe0a091329f4d75), [`e6a8f14`](https://github.com/ankidroid/Anki-Android/commit/e6a8f1498c288c7da11f546dbc64ac8278c77fd8) |

All four commits are ancestors of tag `v2.24.0` (published 2026-05-02) and not of `v2.23.3`
(checked with `git merge-base --is-ancestor`). At `v2.23.3` a card row had only note id, ord,
name, deck id and rendered question and answer. It had no card id and no scheduling
([v2.23.3 CardContentProvider L1119-1127](https://github.com/ankidroid/Anki-Android/blob/v2.23.3/AnkiDroid/src/main/java/com/ichi2/anki/provider/CardContentProvider.kt#L1119-L1127)).
The GitHub release notes for v2.24.0 don't mention the API. These facts come from the code and
tags.

### Reading note types

- `models` and `models/<id>` return id, name, field names (joined by `0x1f`), number of templates,
  CSS, default deck, sort field, type (0 normal, 1 cloze), LaTeX pre and post, and note count
  ([FlashCardsContract L394-450](https://github.com/ankidroid/Anki-Android/blob/ef558bc06e5e63cb74001aac8f1650c09ea51f49/api/src/main/java/com/ichi2/anki/FlashCardsContract.kt#L394-L450),
  [CardContentProvider L1210-1251](https://github.com/ankidroid/Anki-Android/blob/ef558bc06e5e63cb74001aac8f1650c09ea51f49/AnkiDroid/src/main/java/com/ichi2/anki/provider/CardContentProvider.kt#L1210-L1251)).
- `models/<id>/templates` returns each template's ord, name, `question_format`, `answer_format`,
  and the browser formats
  ([FlashCardsContract L474-546](https://github.com/ankidroid/Anki-Android/blob/ef558bc06e5e63cb74001aac8f1650c09ea51f49/api/src/main/java/com/ichi2/anki/FlashCardsContract.kt#L474-L546),
  [CardContentProvider L347-374, L1335-1365](https://github.com/ankidroid/Anki-Android/blob/ef558bc06e5e63cb74001aac8f1650c09ea51f49/AnkiDroid/src/main/java/com/ichi2/anki/provider/CardContentProvider.kt#L1335-L1365)).
- Not exposed: per-field options (font, RTL, sticky, "collapse"), per-template deck override, and
  the note type's modification time. Pull can't cheaply tell that a note type changed, so it has
  to re-read and diff all linked note types. They're small.

### Reading notes

- `notes` takes an Anki search string in `selection`, for example `deck:"Name"`. `notes/<id>`
  reads one note. `notes_v2` takes a raw SQL `WHERE` on the notes table
  ([CardContentProvider L290-315](https://github.com/ankidroid/Anki-Android/blob/ef558bc06e5e63cb74001aac8f1650c09ea51f49/AnkiDroid/src/main/java/com/ichi2/anki/provider/CardContentProvider.kt#L290-L315)).
- Columns: id, guid, mid, mod, usn, tags, flds (fields joined by `0x1f`), sfld, csum, flags, data
  ([FlashCardsContract L183-306](https://github.com/ankidroid/Anki-Android/blob/ef558bc06e5e63cb74001aac8f1650c09ea51f49/api/src/main/java/com/ichi2/anki/FlashCardsContract.kt#L183-L306)).
- For pull: `notes_v2` with `mod > ?` finds notes edited since the last pull. Comparing linked
  note ids against a search on the deck finds new and deleted notes. `notes_v2` is unsanitized SQL
  against `notes`. Don't use it to probe other tables.

### Reading cards and scheduling

- `cards` with an Anki search (`deck:"Name"`, `nid:…`, `cid:…`) and a projection; `cards/<id>`;
  `notes/<nid>/cards` and `notes/<nid>/cards/<ord>`
  ([CardContentProvider L316-331, L474-527](https://github.com/ankidroid/Anki-Android/blob/ef558bc06e5e63cb74001aac8f1650c09ea51f49/AnkiDroid/src/main/java/com/ichi2/anki/provider/CardContentProvider.kt#L474-L527)).
  The default projection doesn't include the scheduling columns. Ask for them by name.
- Every column maps straight to the backend card
  ([CardContentProvider L124-154](https://github.com/ankidroid/Anki-Android/blob/ef558bc06e5e63cb74001aac8f1650c09ea51f49/AnkiDroid/src/main/java/com/ichi2/anki/provider/CardContentProvider.kt#L124-L154)).
  Their meanings ([FlashCardsContract L667-947](https://github.com/ankidroid/Anki-Android/blob/ef558bc06e5e63cb74001aac8f1650c09ea51f49/api/src/main/java/com/ichi2/anki/FlashCardsContract.kt#L667-L947)):
  - `reps`, `lapses`: stored counters.
  - `type`: 0 new, 1 learning, 2 review, 3 relearning.
  - `queue`: -3 and -2 buried, -1 suspended, 0 to 4 active.
  - `due`: a position for new cards, Unix seconds for intraday learning, and a _collection day
    number_ for review cards. The contract says converting that day number to a date needs
    collection-creation and day-cutoff data the API doesn't expose (L783-785).
  - `interval` (days), `sm2_factor`, `left`.
  - `fsrs_stability`, `fsrs_difficulty`, `fsrs_desired_retention`, `fsrs_decay`: `null` when the
    card has no FSRS memory state.
  - **`last_review_time_secs`**: Unix seconds of the last review, stored on the card, `null` if
    absent (L934-947).
- So the review due date can't be read as a date, but it isn't needed:
  `last_review_time_secs + interval` days gives it, and for learning cards `due` is already a
  timestamp.
- Anki writes `last_review_time` on every answer except filtered-deck previews
  ([Anki answering/mod.rs L342-348](https://github.com/ankitects/anki/blob/e64c6b1aee3e8d668fb8bbe084beada8e070d985/rslib/src/scheduler/answering/mod.rs#L342-L348)).
  It increments `reps` on every answer
  ([L184](https://github.com/ankitects/anki/blob/e64c6b1aee3e8d668fb8bbe084beada8e070d985/rslib/src/scheduler/answering/mod.rs#L184)).
  Comparing `reps` is the reliable "was it reviewed since" test. Cards reviewed before Anki began
  storing the field can have `null` there.
- Whether FSRS is on in AnkiDroid is a collection-wide setting
  ([Anki answering/mod.rs L461](https://github.com/ankitects/anki/blob/e64c6b1aee3e8d668fb8bbe084beada8e070d985/rslib/src/scheduler/answering/mod.rs#L461))
  that the API doesn't expose. A non-null `fsrs_stability` on reviewed cards is the practical
  signal.
- **No review log.** No URI returns revlog rows. Grades, per-review times and history before the
  last review aren't available.

### Decks and deck options

- `decks`, `decks/<id>`, `selected_deck`. Columns: name, id, counts `[learn, review, new]`,
  options JSON, is-filtered, description
  ([CardContentProvider L438-473, L1367-1392](https://github.com/ankidroid/Anki-Android/blob/ef558bc06e5e63cb74001aac8f1650c09ea51f49/AnkiDroid/src/main/java/com/ichi2/anki/provider/CardContentProvider.kt#L1367-L1392)).
  Decks nest by `::` in the full name.
- `options` is the deck's legacy config JSON (`configDictForDeckId`, L1381-1384), so it uses
  Anki's schema-11 keys: `new.perDay`, `rev.perDay`, `new.delays`, `lapse.delays`, `maxTaken`,
  `fsrsParams6`, `desiredRetention`
  ([Anki deckconfig/schema11.rs L32-80](https://github.com/ankitects/anki/blob/e64c6b1aee3e8d668fb8bbe084beada8e070d985/rslib/src/deckconfig/schema11.rs#L32-L80)).
  That covers everything our deck options hold.
- Bug: `deck_desc` returns the _currently selected_ deck's description, not the requested deck's
  (`col.decks.current().description`, L1386-1389). Don't import descriptions from it.

### Media

- The provider's only media operation is _insert_: it copies a file from a URI we give it into
  AnkiDroid's `collection.media` and returns the new name
  ([CardContentProvider L1142-1145, L1156-1208](https://github.com/ankidroid/Anki-Android/blob/ef558bc06e5e63cb74001aac8f1650c09ea51f49/AnkiDroid/src/main/java/com/ichi2/anki/provider/CardContentProvider.kt#L1156-L1208)).
  There is no query or `openFile` for media.
- `schedule` rows include `media_files`, which lists the file _names_ in the card
  ([L1283-1286](https://github.com/ankidroid/Anki-Android/blob/ef558bc06e5e63cb74001aac8f1650c09ea51f49/AnkiDroid/src/main/java/com/ichi2/anki/provider/CardContentProvider.kt#L1283-L1286)).
  Fields and rendered HTML also carry names only.
- AnkiDroid's collection folder is either the legacy public `AnkiDroid/` folder or its
  app-specific external folder (`Android/data/<package>/files/…`)
  ([SetupStorage.kt L129-133](https://github.com/ankidroid/Anki-Android/blob/ef558bc06e5e63cb74001aac8f1650c09ea51f49/AnkiDroid/src/main/java/com/ichi2/anki/startup/SetupStorage.kt#L129-L133)).
  The public folder needs storage permissions that the Play Store build disables
  ([manifest L42-43](https://github.com/ankidroid/Anki-Android/blob/ef558bc06e5e63cb74001aac8f1650c09ea51f49/AnkiDroid/src/main/AndroidManifest.xml#L42-L43)).
  Reading the files directly from our app isn't a supported route. Conclusion: **the app can't
  read AnkiDroid's images or audio through the API.**

### Sync back: answering through `schedule`

How it runs, from `update()` on `schedule`:

1. The provider reads `note_id`, `ord`, `answer_ease` (1-4), `time_taken` (ms), `buried` and
   `suspended`, and finds the card by note id and ord
   ([CardContentProvider L738-790, L1419-1435](https://github.com/ankidroid/Anki-Android/blob/ef558bc06e5e63cb74001aac8f1650c09ea51f49/AnkiDroid/src/main/java/com/ichi2/anki/provider/CardContentProvider.kt#L738-L790)).
   It doesn't take a card id.
2. `answerCard` sets the card's timer to `now - time_taken` and calls
   `sched.answerCard(card, rating)`
   ([L1292-1309](https://github.com/ankidroid/Anki-Android/blob/ef558bc06e5e63cb74001aac8f1650c09ea51f49/AnkiDroid/src/main/java/com/ichi2/anki/provider/CardContentProvider.kt#L1292-L1309)).
3. libanki asks the backend for that card's scheduling states _right now_, then builds the answer
   with `answeredAtMillis = now` and `millisecondsTaken = card.timeTaken(col)`
   ([Scheduler.kt L138-170](https://github.com/ankidroid/Anki-Android/blob/ef558bc06e5e63cb74001aac8f1650c09ea51f49/libanki/src/main/java/com/ichi2/anki/libanki/sched/Scheduler.kt#L138-L170)).
   `timeTaken` is `min(elapsed, deck maxTaken × 1000)`
   ([Card.kt L254-267](https://github.com/ankidroid/Anki-Android/blob/ef558bc06e5e63cb74001aac8f1650c09ea51f49/libanki/src/main/java/com/ichi2/anki/libanki/Card.kt#L254-L267)),
   and the backend caps it again
   ([Anki answering/mod.rs L60-62, L324](https://github.com/ankitects/anki/blob/e64c6b1aee3e8d668fb8bbe084beada8e070d985/rslib/src/scheduler/answering/mod.rs#L315-L332)).
4. The backend checks that the state it computes now equals the state passed in. Both come from the
   same moment, so this passes. It then applies the new state, writes a revlog row whose id is
   `answered_at`, updates deck stats, buries siblings per deck config, and sets
   `last_review_time`
   ([Anki answering/mod.rs L315-390](https://github.com/ankitects/anki/blob/e64c6b1aee3e8d668fb8bbe084beada8e070d985/rslib/src/scheduler/answering/mod.rs#L315-L390),
   [revlog.rs L35-50](https://github.com/ankitects/anki/blob/e64c6b1aee3e8d668fb8bbe084beada8e070d985/rslib/src/scheduler/answering/revlog.rs#L35-L50)).

Consequences:

- **A card that isn't due can be answered.** Nothing on this path checks due time or queue
  membership. The current state comes from the card's _type_, not its queue
  ([Anki current.rs L19-137](https://github.com/ankitects/anki/blob/e64c6b1aee3e8d668fb8bbe084beada8e070d985/rslib/src/scheduler/answering/current.rs#L19-L137)).
  For a review card answered early, `elapsed_days` is smaller than the interval (L106-115). With
  FSRS, the next interval comes from the real days elapsed since `last_review_time`
  ([mod.rs L480-492](https://github.com/ankitects/anki/blob/e64c6b1aee3e8d668fb8bbe084beada8e070d985/rslib/src/scheduler/answering/mod.rs#L480-L492)).
  With SM-2, Anki uses its early-review formula. An early answer is logged with review kind
  "Filtered" (revlog type 3) because `days_late() < 0`
  ([Anki states/review.rs L45-61](https://github.com/ankitects/anki/blob/e64c6b1aee3e8d668fb8bbe084beada8e070d985/rslib/src/scheduler/states/review.rs#L45-L61)).
- **A card in learning** moves through its learning steps as if the step were due. Again resets to
  the first step, Hard repeats the step, Good advances one step or graduates, and Easy graduates.
  None of this depends on whether the step's delay has passed
  ([Anki states/learning.rs L39-140](https://github.com/ankitects/anki/blob/e64c6b1aee3e8d668fb8bbe084beada8e070d985/rslib/src/scheduler/states/learning.rs#L39-L140)).
  So reviews of one card synced back together (for example Again, then Good in the same alarm
  session) land seconds apart in AnkiDroid. The card then advances faster than real time. It ends
  in the same step it would have reached, with its next due counted from the sync.
- **The answer time is the sync time.** If a review done on the web reaches the phone two days
  later and is then synced back, AnkiDroid records it two days late. It schedules from that moment
  and its FSRS sees two extra elapsed days. This is the main source of drift, beyond differing FSRS
  parameters.
- **Suspended or buried cards are unsuspended or unburied.** Applying a learning or review state
  sets the queue
  ([Anki review.rs L17](https://github.com/ankitects/anki/blob/e64c6b1aee3e8d668fb8bbe084beada8e070d985/rslib/src/scheduler/answering/review.rs#L17),
  [learning.rs L57-61](https://github.com/ankitects/anki/blob/e64c6b1aee3e8d668fb8bbe084beada8e070d985/rslib/src/scheduler/answering/learning.rs#L57-L61)).
  A leech can be auto-suspended by AnkiDroid's leech action
  ([mod.rs L194-196](https://github.com/ankitects/anki/blob/e64c6b1aee3e8d668fb8bbe084beada8e070d985/rslib/src/scheduler/answering/mod.rs#L194-L196)).
- **Siblings get buried** in AnkiDroid if its deck options say so
  ([mod.rs L339](https://github.com/ankitects/anki/blob/e64c6b1aee3e8d668fb8bbe084beada8e070d985/rslib/src/scheduler/answering/mod.rs#L339)).
- **Failure is invisible.** `answerCard` catches every `RuntimeException`, logs it and sends a
  crash report, and `update()` still counts the row as updated and returns 1
  ([CardContentProvider L770-780, L1305-1308](https://github.com/ankidroid/Anki-Android/blob/ef558bc06e5e63cb74001aac8f1650c09ea51f49/AnkiDroid/src/main/java/com/ichi2/anki/provider/CardContentProvider.kt#L1292-L1309)).
  Bury and suspend behave the same way. Verify each answer by re-reading `reps`.
- Always send `time_taken`. Without it the timer isn't reset, and the recorded time comes from the
  card's default timer start, capped at the deck maximum
  ([L1300-1302](https://github.com/ankidroid/Anki-Android/blob/ef558bc06e5e63cb74001aac8f1650c09ea51f49/AnkiDroid/src/main/java/com/ichi2/anki/provider/CardContentProvider.kt#L1300-L1302)).
- Sending `answer_ease` is required. It is force-unwrapped (`ease!!`, L778).
- `schedule` queries temporarily change AnkiDroid's selected deck and then restore it (L378-435).
  We don't need queries on this URI. Sync back only uses `update`.

### Asking AnkiDroid to sync: `DO_SYNC`

Read for ticket #114 at `v2.24.0`, `v2.25.3` and `main` at
[`210a8a2`](https://github.com/ankidroid/Anki-Android/tree/210a8a2e30be1dc9b21dabb63ae39dc5c1b37963).
Not tried on a phone.

- `com.ichi2.anki.DO_SYNC` is an intent filter (category `DEFAULT`) on the exported, translucent
  activity `IntentHandler`, in all three. It takes `startActivity`, no broadcast, and no permission
  ([manifest L294-297](https://github.com/ankidroid/Anki-Android/blob/210a8a2e30be1dc9b21dabb63ae39dc5c1b37963/AnkiDroid/src/main/AndroidManifest.xml#L294-L297)).
  The wiki agrees that the target must be an Activity.
- The limit in code is 2 minutes, not the wiki's 5. Inside it AnkiDroid shows a `sync_error`
  notification. It also shows one, with the offline text, when logged out or offline
  ([IntentHandler L461-L512](https://github.com/ankidroid/Anki-Android/blob/210a8a2e30be1dc9b21dabb63ae39dc5c1b37963/AnkiDroid/src/main/java/com/ichi2/anki/IntentHandler.kt#L461-L512)).
- The handler opens `DeckPicker`, which starts the sync and finishes itself. On `main` the sync runs
  in `SyncWorker` so it outlives `DeckPicker`. `v2.25.3` calls `deckPicker.sync()` and then
  `deckPicker.finish()`, so whether that sync survives needs a device.
- Nothing comes back to the caller, and `main` also skips the request without a notification when
  a sync is already running or metered sync is blocked.

### What pull and sync back can't do

- They can't read the review log or any review other than the latest one's time.
- They can't set due dates, intervals or memory state. Writable through the API: note fields and
  tags, a card's deck and flag, note type name, CSS and templates, and answer, bury and suspend.
  The writable list is in `update()` (L540-812).
- They can't read media files.
- They can't backdate an answer.
- They can't tell whether FSRS is on in AnkiDroid, except from the data.

## Needs a device

- The exact runtime-permission prompt and how it behaves after AnkiDroid is reinstalled or
  installed after our app (the "install order bug").
- What the client sees when AnkiDroid throws a non-parcelable backend exception, for example an
  unknown note id in `schedule` update. Is it a generic exception, or does AnkiDroid's process die?
- Whether `last_review_time_secs` is `null` for cards last reviewed by older Anki or AnkiDroid
  versions in a real collection, and how often.
- Throughput: how long reading a few thousand cards with the scheduling projection takes. Each row
  loads a card from the backend through `LazyCursor`.
- Whether a provider call blocks or fails while AnkiDroid is syncing with AnkiWeb or has a
  collection operation running.
- How AnkiDroid's FSRS treats the type-3 revlog rows that early sync-back answers create, both for
  its memory state and its optimizer.
- Whether `DO_SYNC` from our activity finishes a sync on `v2.25.3`, and where the user lands after.
- Whether reading files from the legacy public `AnkiDroid/collection.media` folder works from our
  app on Android 11+ with the full (non-Play) AnkiDroid build. This isn't proposed; it only
  confirms the dead end.
