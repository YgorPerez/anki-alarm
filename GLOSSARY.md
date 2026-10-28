# Glossary

**Alarm.** A scheduled ring with a deck, N, sound and options. Turned off only by an alarm session.

**Alarm session.** The study mode the alarm screen opens: cards from the alarm's deck until N are
rated right. The alarm keeps coming back until it ends.

**Awake check.** A prompt a few minutes after dismissal that shows one card. No answer in 60
seconds rings the alarm again.

**Card.** One thing to review, made from a note by one card template (or one cloze number). It has a
memory state.

**Card template.** The front and back HTML of a note type, with field placeholders.

**Deck.** A named set of cards, with deck options. Decks nest.

**Deck options.** Daily new and review limits, desired retention, FSRS parameters and learning steps.

**Dismissal.** The end of an alarm session: N cards rated Good or Easy.

**Grade.** Again, Hard, Good or Easy. Good and Easy count as right in an alarm session.

**Linked deck.** A deck imported from AnkiDroid that keeps AnkiDroid's note and card ids, so it can
be pulled and synced back.

**Memory state.** A card's FSRS stability, difficulty, due date and learning step. Derived by
replaying its reviews, never stored as the truth.

**N.** How many cards an alarm needs rated right before it dismisses.

**Note.** The field values one or more cards are made from.

**Note type.** Fields, card templates and CSS. Cloze is a note type.

**Origin.** Where a review happened: phone, web, alarm session, or imported (from `.apkg` or
AnkiDroid).

**Pull.** Bringing new notes, edits and newer reviews from AnkiDroid into a linked deck.

**Read aloud.** An alarm option that reads each card's front during the session.

**Review.** One answer to a card: an immutable event in the review log.

**Review log.** The append-only list of every review. What syncs, and what memory states come from.

**Reviews ahead.** Cards not yet due, taken soonest first when an alarm has no due or new cards left.

**Snooze cost.** Cards added to an alarm's next ring for each snooze.

**Sync back.** Sending reviews done in the app to AnkiDroid as answers.
