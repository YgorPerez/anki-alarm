import type { TextStyle } from "react-native";

// Atkinson Hyperlegible, loaded in App by these names (React Native takes one font per weight).
export const regular = { fontFamily: "AtkinsonHyperlegible_400Regular" };
export const bold = { fontFamily: "AtkinsonHyperlegible_700Bold" };

// Clock times use Inter to keep zero unslashed; all other text stays Atkinson.
export const clock = {
  fontFamily: "Inter_700Bold",
  fontVariant: ["tabular-nums"],
} satisfies TextStyle;
