---
version: 1
slug: "prototypes-design-index-html"
primary_target: "prototypes/design/index.html"
related_targets: []
---

# Alarm screen and design system prototype

Scope: the alarm session screen on the phone (Operate), plus one deck list in light and dark to test the tokens off the alarm. Throwaway HTML in `prototypes/design/`; DESIGN.md and `packages/design-tokens` are written from it.

Audience and task: an Anki user, half asleep in a dark bedroom, answering N cards right to stop the alarm. Constraints: always-dark alarm; cards in Anki night mode; 48dp targets; large system font scales; a configurable theme (backgrounds, primary, secondary, one color per grade) that must keep contrast AA.

## Direction contract

THESIS: The alarm is a plain black page with the card's words at full size; color does the jobs and nothing else. It refuses the category's grey-card-with-one-accent alarm and the puzzle-alarm toy.

OWN-WORLD: True black ground (dark), white ground (light). Atkinson Hyperlegible throughout, big and bold. Lilac primary (#c9b6ff dark) owns action: Good, progress segments, the clock's accent. Peach secondary (#ffb89a) owns warning: cards left, snooze cost, a card that came back. Each grade has its hue on a dark tinted pill (Again rose, Hard amber, Easy teal); Good alone is solid primary. No card boxes; hairline rule between question and answer.

STORY: The sleeper sees the time, how many are left, the card; answers; the segments fill; the alarm ends on the Nth right card.

FIRST VIEWPORT: Clock 68px bold centered at top, deck path under it; five progress segments; "2 de 5 certos · faltam 3"; question 28px bold, rule, answer 23px; four grade pills in one row at the thumb (64px tall); snooze as an underlined text link below them.

FORM: user-steered hybrid: the category standard's structure in the Feed challenger's visual (catalog pop-culture-shelf-vertical-video-feed-surface), recolored as "Lilac + per-grade tones". seed:a4363ef97027b22e

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
