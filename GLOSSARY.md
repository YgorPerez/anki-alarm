# Glossary

**Alarm.** A scheduled ring with a deck, N, sound and options. Turned off only by an alarm session.

**Alarm session.** The study mode on the alarm screen: cards from the alarm's deck until N are
rated right. It starts when the user taps Start, not when the screen opens. The alarm keeps coming
back until it ends.

**Awake check.** A prompt a few minutes after dismissal that shows one card. No answer in 60
seconds rings the alarm again.

**Card.** One thing to review, made from a note by one card template (or one cloze number). It has a
memory state.

**Card template.** The front and back HTML of a note type, with field placeholders.

**Deck.** A named set of cards that uses one preset, optionally with its own desired retention.
Decks nest.

**Dismissal.** The end of an alarm session: N cards rated Good or Easy.

**Grade.** Again, Hard, Good or Easy. Good and Easy count as right in an alarm session.

**Linked deck.** A deck imported from AnkiDroid that keeps AnkiDroid's note and card ids, so it can
be pulled and synced back.

**Media record.** The synced pairing of a media file name, as fields reference it, with the SHA-256
of its bytes. The file itself is stored once, under that hash.

**Memory state.** A card's FSRS stability, difficulty, due date and learning step. Derived by
replaying its review log entries, never stored as the truth.

**N.** How many cards an alarm needs rated right before it dismisses.

**Note.** The field values one or more cards are made from.

**Note type.** Fields, card templates and CSS. Cloze is a note type.

**Origin.** Where a review happened: phone, web, alarm session, or imported (from `.apkg` or
AnkiDroid).

**Preset.** A named set of options that many decks share: daily new and review limits, desired
retention, FSRS parameters and learning steps.
_Avoid_: deck options (that's the screen), options group

**Pull.** Bringing new notes, edits and AnkiDroid's newer card states into a linked deck. Always
runs a sync back first.

**Read aloud.** An alarm option that reads each card's front during the session.

**Ring.** One firing of an alarm, from its first sound to dismissal. It lasts through snoozes, and
an alarm that comes due during it is folded into it. A failed awake check starts a new ring.
_Avoid_: wake-up (on its own, for the event)

**Reset.** A log entry that returns a card to new, at the end of the new queue, with its review
and lapse counts starting over. Its earlier reviews stay in the log.
_Avoid_: forget (the action's name in the UI, not the entry)

**Review.** One answer to a card: an immutable event in the review log.

**Review log.** The append-only list of reviews, snapshots, resets, set due dates and voids. What
syncs, and what memory states come from.

**Reviews ahead.** Cards not yet due, taken soonest first when an alarm has no due or new cards left.

**Set due date.** A log entry that moves a card's due date and keeps the rest of its memory state.

**Snapshot.** A log entry holding a linked card's memory state as AnkiDroid had it at its last
review. Replay adopts it. It has no grade.

**Snooze cost.** Cards added to an alarm's next ring for each snooze.

**Study day.** The day daily limits and "due today" count in. It starts at the user's chosen hour,
4 am by default.

**Sync back.** Sending reviews done in the app to AnkiDroid as answers.

**Theme.** The colors a user picks: a background for light mode and one for dark, a primary (action:
Good, progress), a secondary (warning: cards left, snooze) and one color per grade. It syncs, and
the alarm screen, the splash and the app icon follow it.
_Avoid_: skin, palette (that's the set of swatches to pick from)

**Wake-up stats.** The stats set from the alarm journal: per alarm and overall, time from ring to
dismissal, snoozes, cards needed, and awake check passes and failures. A deleted alarm's rings stay
in them, labelled as deleted. "Wake-up" names this set only; one firing is a ring.

**Void.** A log entry that cancels one earlier entry (a review, reset or set due date), written by
Undo. Replay skips voided entries.
