import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { editorFixture } from "./editor-fixtures.ts";
import { NoteEditor } from "./note-editor.tsx";

const { state, englishId } = editorFixture();
const meta = {
  title: "Editing/Note",
  component: NoteEditor,
  args: {
    noteTypes: state.noteTypes,
    decks: state.decks,
    deckId: englishId,
    locale: "pt-BR",
    onSave: fn(async () => {}),
  },
  parameters: { layout: "padded" },
} satisfies Meta<typeof NoteEditor>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NewNote: Story = {
  args: { onSave: fn(async () => {}) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const add = canvas.getByRole("button", { name: "Adicionar" });
    await expect(add).toBeDisabled();
    await userEvent.type(canvas.getByLabelText("Frente"), "dog");
    await userEvent.type(canvas.getByLabelText("Verso"), "cão");
    await userEvent.click(add);
    await expect(args.onSave).toHaveBeenCalledWith({
      noteTypeId: state.noteTypes[0]!.id,
      deckId: englishId,
      values: ["dog", "cão"],
    });
    await expect(await canvas.findByText("Nota adicionada.")).toBeInTheDocument();
    // The form empties for the next note.
    await expect(canvas.getByLabelText("Frente")).toHaveValue("");
  },
};

export const EditSavesAsYouType: Story = {
  args: { note: state.notes[0], onSave: fn(async () => {}) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("As mudanças são salvas enquanto você digita.")).toBeVisible();
    const back = canvas.getByLabelText("Verso");
    await userEvent.type(back, "!");
    await expect(args.onSave).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(args.onSave).toHaveBeenCalledWith(
        expect.objectContaining({ values: ["cat", "gato!"] }),
      ),
    );
    await expect(args.onSave).toHaveBeenCalledOnce();
  },
};

export const SaveFails: Story = {
  args: {
    note: state.notes[0],
    onSave: fn(async () => {
      throw new Error("Storage unavailable");
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("Frente"), "s");
    // Leaving the field saves at once.
    await userEvent.tab();
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Não foi possível salvar. Seus dados anteriores foram mantidos. Tente novamente.",
    );
  },
};

export const FirstFieldRequired: Story = {
  args: { note: state.notes[0], locale: "en", onSave: fn(async () => {}) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.clear(canvas.getByLabelText("Front"));
    await userEvent.tab();
    await expect(await canvas.findByText("Fill in the first field.")).toBeVisible();
    await expect(args.onSave).not.toHaveBeenCalled();
  },
};
