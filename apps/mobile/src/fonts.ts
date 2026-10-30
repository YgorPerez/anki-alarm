import type { TextStyle } from "react-native";

// Atkinson Hyperlegible, loaded in App by these names (React Native takes one font per weight).
export const regular = { fontFamily: "AtkinsonHyperlegible_400Regular" };
export const bold = { fontFamily: "AtkinsonHyperlegible_700Bold" };

// Clock times use Inter to keep zero unslashed; all other text stays Atkinson.
export const clock = {
  fontFamily: "Inter_700Bold",
  fontVariant: ["tabular-nums"],
} satisfies TextStyle;

/**
 * How wide Inter Bold's figures set, in font sizes, side bearings included: "12:30" on a large
 * clock screen and on Home's card, and a wheel's two digits.
 */
export const CLOCK_EMS = { screen: 3.5, card: 3.3, wheelDigits: 1.55 };

/** The largest clock size, up to `max`, whose text fits `width` once the system scales it. */
export const fittedClockSize = (width: number, ems: number, fontScale: number, max: number) =>
  Math.min(max, width / (ems * fontScale));
