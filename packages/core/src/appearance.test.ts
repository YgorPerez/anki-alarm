import { expect, test } from "vite-plus/test";
import { FACTORY_THEME, nativeAppearance } from "./index.ts";

test("native appearance uses factory resource indices", () => {
  expect(nativeAppearance(FACTORY_THEME)).toEqual({ light: 0, dark: 0, primary: 0, secondary: 0 });
});

test("free colors use perceptually nearest swatches independently for both modes and the icon", () => {
  expect(
    nativeAppearance({
      ...FACTORY_THEME,
      lightBackground: "#f6f4fa",
      darkBackground: "#0b111f",
      primary: "#80d3fe",
      secondary: "#80dfce",
    }),
  ).toEqual({ light: 1, dark: 2, primary: 1, secondary: 2 });
});
