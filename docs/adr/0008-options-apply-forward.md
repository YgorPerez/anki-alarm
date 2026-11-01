# Deck options apply forward

Changing a deck option never moves a card already answered. Until now replay ran a card's whole log
through the preset as it is today, so editing retention or steps rewrote every due date in the deck,
and a small tweak could create a pile of overdue cards. Now that users get many more scheduling
options (maximum interval, relearning steps, easy days), we made options apply only to later
answers, as Anki does when it doesn't reschedule. Decided in the 2026-11-01 deck options grilling.

## The decision

- Each new review records the scheduling options it was answered with, and replay uses those. The
  log stays the only truth and stays immutable.
- Reviews logged before this change have no options of their own. They replay under the options
  their deck's preset had when the change arrived, so the update itself moves no due dates.
- Only answers read a preset's current options. There is no "reschedule existing cards" action.

## Considered

- **Keep replaying under current options, with a warning.** No migration, but one edit still moves
  many cards.
- **Ask on save whether to reschedule.** The most flexible and needs both paths. It can come later:
  a reschedule can be appended to the log.
- **A dated history of each preset's options.** Keeps reviews small, but moving a deck to another
  preset and concurrent edits on two devices make it harder to get the same answer everywhere.

## Consequences

- Review entries grow, and the wire format changes, so `SYNC_PROTOCOL` goes up in lockstep
  (ADR 0002).
- Two devices that haven't synced an option change can answer under different options. Each review
  keeps what its device used, and replay still converges.
