import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fireEvent, fn, userEvent, within } from "storybook/test";

import { DeckOptionsEditor } from "./deck-options-editor.tsx";
import { editorFixture } from "./editor-fixtures.ts";

const { state } = editorFixture();
const meta = {
  title: "Editing/Deck options",
  component: DeckOptionsEditor,
  args: { preset: state.presets[0]!, deckCount: 2, locale: "pt-BR", onSave: fn(async () => {}) },
  parameters: { layout: "padded" },
} satisfies Meta<typeof DeckOptionsEditor>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SharedPreset: Story = {
  args: { onSave: fn(async () => {}) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Estas opções valem para 2 baralhos.")).toBeVisible();
    const retention = canvas.getByLabelText("Retenção desejada");
    await expect(retention).toHaveValue("90");
    await fireEvent.change(retention, { target: { value: "85" } });
    await userEvent.click(canvas.getByRole("button", { name: "Salvar" }));
    await expect(args.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ desiredRetention: 0.85, newPerDay: 20, learningSteps: [1, 10] }),
    );
    await expect(await canvas.findByText("Salvo.")).toBeVisible();
  },
};

export const InvalidOptions: Story = {
  args: { deckCount: 1, locale: "en", onSave: fn(async () => {}) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const steps = canvas.getByLabelText("Learning steps (minutes)");
    await userEvent.clear(steps);
    await userEvent.type(steps, "1 0");
    await expect(
      await canvas.findByText("Use minutes above zero, separated by spaces."),
    ).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Save" })).toBeDisabled();
    await expect(args.onSave).not.toHaveBeenCalled();
  },
};
