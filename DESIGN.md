---
name: anki-alarm
description: An alarm clock you turn off with flashcards; black page, big words, color only where it works.
colors:
  background: "#ffffff"
  foreground: "#16131d"
  surface: "#f3f3f4"
  border: "#e3e3e4"
  track: "#dededf"
  muted-foreground: "#76747a"
  answer: "#3b3941"
  primary: "#8169b8"
  primary-foreground: "#ffffff"
  primary-ink: "#8169b8"
  primary-tint: "#f5f2ff"
  attention: "#aa5832"
  attention-tint: "#fff1eb"
  good: "#8169b8"
  good-foreground: "#ffffff"
  again: "#b93a5f"
  again-tint: "#ffe4eb"
  again-ink: "#c8496c"
  hard: "#887100"
  hard-tint: "#fff9e0"
  hard-ink: "#8b7400"
  easy: "#097e70"
  easy-tint: "#e5f9f5"
  easy-ink: "#078476"
  destructive: "#c62828"
  background-dark: "#000000"
  foreground-dark: "#ffffff"
  surface-dark: "#1c1c1c"
  border-dark: "#292929"
  track-dark: "#333333"
  muted-foreground-dark: "#8c8c8c"
  answer-dark: "#d6d6d6"
  primary-dark: "#c9b6ff"
  primary-foreground-dark: "#120d1c"
  primary-ink-dark: "#c9b6ff"
  primary-tint-dark: "#282433"
  attention-dark: "#ffb89a"
  attention-tint-dark: "#2e211c"
  good-dark: "#c9b6ff"
  good-foreground-dark: "#120d1c"
  again-dark: "#ff7a9a"
  again-tint-dark: "#33181f"
  again-ink-dark: "#ff7a9a"
  hard-dark: "#ffe066"
  hard-tint-dark: "#332d14"
  hard-ink-dark: "#ffe066"
  easy-dark: "#7fe0cf"
  easy-tint-dark: "#192d29"
  easy-ink-dark: "#7fe0cf"
  destructive-dark: "#ff6b6b"
typography:
  clock:
    fontFamily: "Atkinson Hyperlegible"
    fontSize: "68px"
    fontWeight: 700
    lineHeight: "76px"
    letterSpacing: "-1px"
  title:
    fontFamily: "Atkinson Hyperlegible"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: "36px"
  question:
    fontFamily: "Atkinson Hyperlegible"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: "35px"
  answer:
    fontFamily: "Atkinson Hyperlegible"
    fontSize: "23px"
    fontWeight: 400
    lineHeight: "32px"
  body:
    fontFamily: "Atkinson Hyperlegible"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: "24px"
  label:
    fontFamily: "Atkinson Hyperlegible"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: "20px"
  caption:
    fontFamily: "Atkinson Hyperlegible"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "18px"
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  pill: "999px"
components:
  grade-good:
    backgroundColor: "{colors.good}"
    textColor: "{colors.good-foreground}"
    rounded: "{rounded.pill}"
    height: "64px"
  grade-again:
    backgroundColor: "{colors.again-tint}"
    textColor: "{colors.again}"
    rounded: "{rounded.pill}"
    height: "64px"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.pill}"
    height: "64px"
  button-neutral:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.pill}"
    height: "64px"
---

# Design System: anki-alarm

## Overview

A plain black page with the card's words at full size; color does jobs and nothing else. The alarm
screen is the center of the system: it's seen half asleep in a dark bedroom, so everything is
large, high-contrast and in the same place every morning. The rest of the app (decks, study,
editor, stats, settings) uses the same type, colors and controls, on the phone and the web.

The look started from the alarm category's standard structure (big clock, progress, card, grade
row, snooze) set in a full-bleed feed's visual: true black, white type, no boxes around the card.
Then it was given one lilac for action, one peach for attention, and one hue per grade. The
direction and its sketches are in `.impeccable/` and `prototypes/design/` (#3).

Users can recolor all of it in Settings › Theme. These are the factory colors; see Colors › Theme.

## Colors

Hex values in the frontmatter are the factory theme, light and `-dark`. They're the same values as
`packages/design-tokens/tokens.css`, where shadcn's names (`card`, `popover`, `secondary`, `muted`,
`accent`, `ring`, `chart-*`, `sidebar-*`) alias these roles.

### Primary

**Lilac** (`primary`, `#c9b6ff` on dark; deepened to `#8169b8` on white so white ink reads on it):
action. The Good grade, the Start button, progress segments, the selected tab, focus rings. A
solid lilac fill always means "the thing to press". `primary-ink` is lilac as text on the ground,
and `primary-tint` is a faint lilac wash for selection.

### Secondary

**Peach** (`attention`, `#ffb89a` on dark, `#aa5832` on white): what needs your attention. Cards
left in a session, the snooze cost, a card that came back after Again, the awake check's
countdown, "daily limit reached". `attention-tint` backs its chips. In the theme settings and the
glossary this is the user's "secondary" color; the token is named `attention` because shadcn's
`secondary` is the neutral surface of secondary buttons.

### Grades

Each grade has a hue, the same on the alarm, in normal study and in stats (the `chart-*` series):

- **Again** rose `#ff7a9a`, **Hard** yellow `#ffe066`, **Easy** teal `#7fe0cf`: drawn as text in
  their hue (`again`, `hard`, `easy`) on a dark or pale tint of it (`*-tint`). `*-ink` is the hue
  as text on the plain ground (deck counts, stats labels).
- **Good** is solid primary (`good`, `good-foreground`), the only solid grade, because it's the
  answer the alarm wants.

The grade hues were picked to stay apart from each other and from peach (OKLab distance ≥ 0.13).

### Neutral

`background` (true black on dark, white on light), `foreground`, `surface` (raised fills: neutral
buttons, the today card, popovers on dark), `border` (hairlines between rows and under the
question), `track` (empty progress), `muted-foreground` (secondary text, AA on the ground) and
`answer` (the revealed back, a step quieter than the question).

`destructive` (`#ff6b6b` / `#c62828`) is for Delete and Remove only, and isn't themeable, so a
recolored Again never makes deleting look like grading.

### Theme

Settings › Theme sets a background for each mode, the primary, the secondary and one color per
grade, from swatches or a free picker. Core derives every token from those choices with the
same rules that made the factory values:

- An ink moves only in OKLCH lightness (hue kept, chroma at least 0.12 on light grounds) until it
  reaches WCAG AA (4.5:1) on what it sits on.
- On light grounds, solid fills (primary, Good) are deepened until white ink reads on them.
- Tints and neutrals are sRGB mixes of the color with the ground.
- Mid grounds, where neither white nor near-black text has much room, still reach AA: text falls
  back to pure black or white, `surface` steps away from the text instead of toward it, and the
  attention chip's tint moves toward the ground until its text reads on both.
- Pairs closer than 0.09 in OKLab, among the grades, the primary and the secondary, get a warning,
  never a block.

The alarm screen uses the dark choice. The choice syncs, and the splash and icon follow it. See
`docs/adr/0004-configurable-theme.md`.

### Named Rules

**One solid per screen.** At most one solid primary fill on a screen: the thing to press.
Everything else is tint, text or neutral surface.

**Color means a job.** Lilac is action, peach is attention, a grade hue is that grade. A color that
does none of these is a neutral.

## Typography

Atkinson Hyperlegible everywhere, regular and bold, bundled with both apps. It was drawn for low
vision: I, l and 1 differ, 0 is slashed, and letters keep open shapes. That is the "half asleep,
no glasses" case. On the phone, sizes are in sp and follow the system font size; layouts must hold
at 1.3×.

### Hierarchy

- **Clock** 68/76 bold, tabular figures: the alarm's time, the snoozed-until time, "5 de 5".
- **Title** 30/36 bold: a screen's name (Baralhos).
- **Question** 28/35 bold: a card's front on the alarm, plus big one-line statements ("Adiado.").
- **Answer** 23/32 regular, in `answer`: the revealed back.
- **Body** 17/24: rows, buttons, normal text.
- **Label** 15/20: deck path, counts, links, "2 de 5 certos".
- **Caption** 13/18: grade intervals under a grade, tab labels.

Card content itself is Anki HTML with the deck's own CSS, so its type is the deck author's. On the
alarm and in study the card renders in Anki's night mode on dark grounds (`.nightMode`,
`.night_mode` classes and a dark default for cards without night styles).

## Layout

Phone first, one column, 16–24px side margins. The alarm screen is fixed, so the hands learn it:

- Top: clock, deck path, progress segments (one per card to get right), then "2 de 5 certos ·
  faltam 3".
- Middle: question, hairline rule, answer. No card box.
- Bottom, at the thumb: one row of four 64px grade pills, or one full-width 64px button (Start,
  Show answer, Answer now, Close). The snooze link sits below them, apart from every grade.

App screens: a top title, then content, then Material's bottom navigation bar (Baralhos, Alarmes,
Estatísticas, Ajustes) on the phone. The web uses the same order with shadcn's sidebar.

### Named Rules

**Snooze stands alone.** Snooze is never next to a grade or a primary button.

## Elevation & Depth

Flat. Depth is a step of `surface` over the ground and hairline `border`s, never shadows. On the
web, popovers and dialogs may take one soft shadow.

## Shapes

Pills (`rounded.pill`) for every button and grade, chips included. Rounded rectangles for
containers: `lg` 16px for sheets and dialogs, `xl` 20px for the today card. Hairlines are 1px.

## Components

### Grade buttons

A row of four equal pills, 64px tall, label in Body bold with the interval in Caption under it:
De novo, Difícil, Bom, Fácil, in Anki's order. They appear a few seconds after the reveal. Good is
solid primary; the others are their hue on its tint.

### Primary and neutral buttons

Full-width 64px pills on the alarm. Primary (solid lilac) only for Start; Show answer, Answer now
and Close are neutral (`surface`). In app screens, buttons are 48dp minimum.

### Progress segments

One 5px rounded segment per card to get right, filled in primary as each one counts. The awake
check uses a single draining bar in attention for its 60 seconds.

### Attention chip

A pill in `attention` on `attention-tint`: "Voltou: você errou há 2 min". It stays until the card
is answered.

### Deck row

Name in Body, optional second line in Label (`muted-foreground`, or `attention` for "Limite diário
atingido"), then three tabular counts: new in `easy-ink`, learning in `again-ink`, due in bold
`primary-ink`; a zero is muted. Subdecks indent 20px. Rows are 64px with a hairline between them.

### Navigation

Material 3 navigation bar on the phone: four destinations, the active one with a `primary-tint`
indicator and bold label. System Back always works; it never dismisses an alarm session.

## Do's and Don'ts

### Do:

- Do keep the alarm screen dark and its layout fixed, whatever the theme.
- Do run every new color pair through the theme derivation so it meets AA.
- Do use the grade hues for grades everywhere, including stats.

### Don't:

- Don't put a box, card or shadow around the card's content.
- Don't add a third accent; a color that isn't action, attention or a grade is a neutral.
- Don't place snooze within reach of a grade.
- Don't cheer or scold in copy ("Ótimo!", "Você consegue!"). Say the count: "3 de 5."
