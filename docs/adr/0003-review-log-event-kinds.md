# Review log event kinds

The review log holds five kinds of entry: **review**, **snapshot**, **reset**, **set due date** and
**void**. Replay folds them in answer-time order into each card's memory state. We added the three
non-grade kinds because Anki's revlog and AnkiDroid's API both carry schedule changes that aren't
answers, and the log is the only truth. We kept them separate instead of using one generic "state
override" so the log still says why a card's state changed, which stats, export and Undo need.
Decided in the 2026-10-28 grilling on the research results for #4 and #5.

## The kinds

- **Review.** One grade, as before.
- **Snapshot.** A linked card's memory state (stability, difficulty, due, step, plus the change in
  reps and lapses) as AnkiDroid had it, timed at its last review there. Pull writes one when
  AnkiDroid reviewed the card after our last entry for it. Replay adopts the state and carries on
  from it. It has no grade, because AnkiDroid's API exposes no review history.
- **Reset.** Returns the card to new, at the end of the new queue, with review and lapse counts
  starting over. Written by Forget in the app and by Anki's Forget entries on import. Earlier reviews
  stay in the log and in stats.
- **Set due date.** Moves the due date only. Stability and difficulty stay, as in Anki with FSRS.
  Written by Set due date in the app and by Anki's set-due and reschedule entries on import.
- **Void.** Cancels one earlier entry the user made (review, reset or set due date). Written by Undo.

Anki's cram entries are skipped on import. Imported entries take UUIDv5 ids from the revlog id, as in
ADR 0001.

## Consequences

- Pull always runs sync back first. Otherwise a snapshot taken before our answers reach AnkiDroid
  would leave them out, and sync back would then apply them on top: a double count.
- AnkiDroid's API can't write resets or due dates. A reset or set due date on a linked card stays in
  the app (the UI says so), and AnkiDroid's next review of that card snapshots over it.
- Export writes reset and set due date as Anki's non-grade revlog entries (Anki's own reset and
  set-due entries, not answers). A snapshot has no Anki equivalent.
- A future FSRS optimizer trains on reviews only. Snapshots, resets and set due dates are boundaries
  in a card's history, never training data.

## Considered options

- **One "state override" kind.** Fewer kinds, but the log loses the reason for each change.
- **Inferred reviews for AnkiDroid** (Again if lapses rose, otherwise Good). Fits the old log shape,
  but feeds made-up grades to stats and the optimizer.
- **Cutting history at resets on import.** No new kinds, but due dates set by hand in Anki are lost
  and the history before a reset disappears from stats.
