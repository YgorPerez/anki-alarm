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
    fontFamily: "Inter"
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

Atkinson Hyperlegible regular and bold is bundled with both apps for general text. It was drawn
for low vision: I, l and 1 differ, 0 is slashed, and letters keep open shapes.

On the phone, clock times use bundled Inter bold with tabular figures and an unslashed zero:
Home's clock and alarm rows, the editor's time, and the large times on ringing, snoozed and native
lock-screen screens. Other text, including progress counts and AM/PM beside the large clock,
stays Atkinson. The web keeps Atkinson. Decided in #94; implemented in #95.

Sizes on the phone are in sp and follow the system font size; layouts must hold at 1.3×. The
native lock-screen font resource requires an APK rebuild; an OTA update alone cannot install it.

### Hierarchy

- **Clock** 68/76 bold, tabular figures: Inter for phone clock times, including the alarm's time
  and the snoozed-until time. Progress such as "5 de 5" stays Atkinson.
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

Phone first, one column, 16–24px side margins except the full-width study card.

While an alarm card is showing, the top is one compact line of Body text: time, progress and a
small Snooze link at the end. The awake check uses time, one-card progress and seconds remaining.
Decks study uses a back link with the deck name on the left and Undo on the right.
The big clock and alarm label remain on Start; stages without cards retain their existing layout.

The card fills the width and all height between the header and bottom strip, with no frame.
Its default text stays 28px and follows system font scale; deck CSS is preserved. Short content
leaves blank space below it and long content scrolls inside the card. A tap reveals the answer;
a drag only scrolls. The faint hint "Toque para ver a resposta" / "Tap to see the answer" and a
screen-reader accessibility action replace the Show answer button.

The bottom strip reserves 64px before and after reveal. Four equal 64px grade pills share a row;
when scaled text cannot fit, they use two rows and reserve that height on both sides of the card.
The alarm's grade delay keeps the same space reserved. Card height never jumps on reveal.

Phone screens use Expo Router with three bottom tabs, in order: Alarmes, Baralhos, Estatísticas
(Alarms, Decks, Stats). Every tab has a Settings gear at the top. Settings groups alarm reliability,
theme, language, account and the update offer; theme and reliability open within its stack. The web
uses shadcn's sidebar.

### Named Rules

**Snooze stands alone.** During study, Snooze sits in the header, away from the grades.

## Elevation & Depth

Flat. Depth is a step of `surface` over the ground and hairline `border`s, never shadows. On the
web, popovers and dialogs may take one soft shadow.

## Shapes

The phone uses two radii: **pill to press, 16px to contain**. Buttons, grades, chips, toggles and
segments use `rounded-pill` (999px). Cards, fields, sheets, dialogs and banners use `rounded-lg`
(16px), including containers that open a screen when tapped. Hairlines are 1px.

`vp lint apps/mobile` enforces this scale with zero violations. Use these two classes rather than
radius aliases, arbitrary values or dynamic class names. Inline `borderRadius` and corner radius
properties accept only the numeric literals `16` and `999`.

The web keeps its existing scale: pills for controls, `lg` 16px for sheets and dialogs, and `xl`
20px for the today card. The shared radius tokens remain unchanged.

## Components

### Grade buttons

A row of four equal pills, 64px tall, label in Body bold with the interval in Caption under it:
De novo, Difícil, Bom, Fácil, in Anki's order. They appear a few seconds after the reveal. Good is
solid primary; the others are their hue on its tint.

### Primary and neutral buttons

Full-width 64px pills on the alarm. Primary (solid lilac) only for Start; Answer now
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

### Alarm Home

A centered Title countdown replaces the live clock, with the next ring's day and time in muted
Body below it. With nothing enabled, the same space says "Nenhum alarme ativo" / "No active
alarms". Days, hours and minutes appear only when nonzero; a partial minute rounds up.

Cards use a 16px surface, a large Inter time (44sp, reduced as needed on narrow screens), seven
Caption day letters with selected days bold, and one ellipsized Label line: name or deck, then
the card count. A one-off shows its date instead of day letters. The full summary stays in the
card's accessibility label. The switch sits beside the content and remains independent.
Disabled times and day letters use muted ink; the card keeps full opacity. A skipped ring keeps
its peach marker until that occurrence passes, even when disabled.

Tap opens the editor. Long-press opens Skip next / Undo skip, Duplicate and destructive Delete;
TalkBack exposes the same menu as a named accessibility action. There is no overflow button.
Swipe deletion keeps its Undo. The list scrolls, day letters can wrap, and the countdown wraps
with system font scale, including 1.3×. Decided in #94; implemented in #100.

### Alarm editor

The phone editor starts with looping hour and minute wheels in Inter Bold, with a smaller AM/PM
wheel only when the phone uses 12-hour time. The selected values use foreground ink; neighboring
values are quieter. Rows grow with system font scale and snap to whole values. Each wheel is one
adjustable accessibility control with a spoken value and increment/decrement actions.

Under the wheels, on the ground with no box: the repeat summary in Body with a muted calendar icon,
seven day letters, and the name field. Letters are 48dp pills, Sunday first; a selected one is
`primary-ink` bold on `primary-tint`, the rest are foreground with no fill. Their row runs 12dp past
the 24dp margin so seven targets fit a 360dp phone, and wraps on anything narrower.

The phone editor has no top bar. Its settings scroll above a fixed, full-width bottom bar with a
hairline top border and safe-area padding. Cancelar / Cancel is a neutral pill; Salvar / Save is
the solid primary pill. Both share the width equally and follow system font scale. Saved alarms
place Skip next, Duplicate and destructive Delete at the end of the scroll, apart from Save.
Cancel and system Back ask before discarding changed values; Back closes a settings sheet first.

### Navigation

Material 3 navigation bar on the phone: three destinations, the active one with a `primary-tint`
indicator and bold label. System Back goes back within the current tab and exits from a tab root.
Settings returns to the tab that opened it. A ring or shown awake check takes over outside the
navigator and consumes Back; it never dismisses an alarm session.

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
