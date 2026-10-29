import { noteTypeImpact } from "@app/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { editorFixture } from "./editor-fixtures.ts";
import { NoteTypeEditor } from "./note-type-editor.tsx";

const { state } = editorFixture();
const type = state.noteTypes[0]!;
const meta = {
  title: "Editing/Note type",
  component: NoteTypeEditor,
  args: {
    type,
    sample: state.notes[0],
    noteCount: state.notes.length,
    impact: (edit) => noteTypeImpact(state, type.id, edit),
    locale: "pt-BR",
    onSave: fn(async () => {}),
  },
  parameters: { layout: "padded" },
} satisfies Meta<typeof NoteTypeEditor>;
export default meta;
type Story = StoryObj<typeof meta>;

const srcdoc = (canvas: ReturnType<typeof within>, title: string) =>
  canvas.getByTitle(title).getAttribute("srcdoc") ?? "";

export const PreviewFollowsTheTemplate: Story = {
  args: { onSave: fn(async () => {}) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(srcdoc(canvas, "Prévia da frente")).toContain("cat");
    await userEvent.click(canvas.getByRole("button", { name: "Reverse" }));
    await expect(srcdoc(canvas, "Prévia da frente")).toContain("gato");
    const front = canvas.getByLabelText("Modelo da frente");
    await userEvent.clear(front);
    await userEvent.type(front, "<b>{{{{Back}}</b>");
    await expect(srcdoc(canvas, "Prévia da frente")).toContain("<b>gato</b>");
    await userEvent.click(canvas.getByRole("button", { name: "Salvar" }));
    await expect(args.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        templates: [
          expect.objectContaining({ name: "Card 1", from: 0 }),
          expect.objectContaining({ name: "Reverse", front: "<b>{{Back}}</b>", from: 1 }),
        ],
      }),
    );
  },
};

export const AsksBeforeDeletingCards: Story = {
  args: { onSave: fn(async () => {}) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Reverse" }));
    await userEvent.click(canvas.getByRole("button", { name: "Remover Reverse" }));
    await userEvent.click(canvas.getByRole("button", { name: "Salvar" }));
    await expect(
      canvas.getByText(
        "Ao salvar: 0 valores preenchidos serão apagados, 2 cartões excluídos e 0 cartões criados.",
      ),
    ).toBeVisible();
    await expect(args.onSave).not.toHaveBeenCalled();
    await userEvent.click(canvas.getByRole("button", { name: "Salvar mesmo assim" }));
    await expect(args.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ templates: [expect.objectContaining({ name: "Card 1" })] }),
    );
  },
};

export const ProblemsBlockSaving: Story = {
  args: { locale: "en", onSave: fn(async () => {}) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Add field" }));
    const field = canvas.getByLabelText("Name of field 3");
    await userEvent.clear(field);
    await userEvent.type(field, "front");
    await expect(canvas.getByText("Two fields have the same name.")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Save" })).toBeDisabled();
  },
};
