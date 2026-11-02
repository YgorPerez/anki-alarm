import { contrast } from "@app/core";
import { render, screen } from "@testing-library/react-native/pure";
import { expect, test } from "vite-plus/test";
import { StudyCounts } from "./StudyCounts.tsx";

test.each([
  ["1 novo", "#006cff"],
  ["2 aprendendo", "#ec0000"],
  ["3 revisões", "#008900"],
] as const)(
  "%s has its fixed Anki colour, readable on the white and the black page",
  async (label, color) => {
    await render(<StudyCounts counts={{ new: 1, learning: 2, review: 3 }} locale="pt-BR" />);
    expect(screen.getByLabelText(label).props.style).toEqual({ color });
    expect(contrast(color, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color, "#000000")).toBeGreaterThanOrEqual(4.5);
  },
);
