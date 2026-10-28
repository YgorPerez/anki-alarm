# A configurable theme, derived and checked in Core

Users pick their own colors in Settings › Theme: a background for light mode and one for dark, a
primary (action: Good, progress), a secondary (warning: cards left, snooze) and one color per grade.
Each comes from preset swatches or a free color picker. Core turns those choices into every
`--color-*` token, fixes contrast and warns about look-alike colors, so no choice can make the alarm
screen unreadable at 6 am. The choice syncs, and the alarm screen, the launch splash and the app
icon follow it. This copies wave's Settings › Theme. Decided in #3.

## Where the colors live

- `packages/core` owns the factory theme, the swatches, and `themeFor(choice, mode)`, which derives
  every token by the rules in DESIGN.md › Colors › Theme: inks move in OKLCH lightness until they
  reach WCAG AA on what they sit on, the ink on a solid fill is picked for contrast, tints are mixes
  of the color and the ground. Core also reports pairs that look alike (OKLab distance under 0.09)
  among the grades, the primary and the secondary. That's a warning, not a block, so neighboring
  tones stay possible. `prototypes/design/index.html` has a working version of these rules.
- `packages/design-tokens/tokens.css` is the factory theme, in the shape from
  `docs/research/design-tokens.md`. Its test checks it against DESIGN.md and checks contrast; once
  Core's theme module exists, it also checks that Core derives exactly these values.
- The phone lays the derived theme over `tokens.css` at runtime with `Uniwind.updateCSSVariables`.
  The web sets the same variables on `<html>`.

## What follows the theme

- **The alarm screen** is always dark, so it uses the dark background with the user's colors.
- **Sync:** the choice is a setting like any other, merged field by field (ADR 0001).
- **Launch splash:** a config plugin ships one splash style per choice the swatches can make, and
  the app saves the current choice natively so Android opens on the right ground (Android 13+).
  A free-picked color falls back to the nearest swatch for the splash.
- **App icon:** Android can't recolor a launcher icon, so the app ships one icon per primary and
  secondary swatch pair as activity aliases, and switches when it leaves the screen. Where the
  launcher drops the home-screen icon on a switch, Settings asks first.

## Considered

- **Fixed palette, no settings.** Simplest, but the owner wanted wave's personalization.
- **Colors only in `tokens.css`.** Core would have to parse CSS to check contrast, against its
  zero-dependency rule.
- **Splash and icon fixed.** Much less native work. Rejected: the owner wanted the whole app to wear
  the chosen colors, as wave does.
