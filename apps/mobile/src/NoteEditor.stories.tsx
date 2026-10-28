import type { Meta, StoryObj } from "@storybook/react-native";
import { editorFixture } from "./editor-fixtures.ts";
import { NoteEditor } from "./NoteEditor.tsx";

const { state, words, basic, note } = editorFixture();
const meta = {
  title: "Editing/Note",
  component: NoteEditor,
  args: {
    noteTypes: state.noteTypes,
    decks: state.decks,
    deckId: words.id,
    locale: "pt-BR",
    busy: false,
    onSave: () => {},
    onCancel: () => {},
  },
} satisfies Meta<typeof NoteEditor>;
export default meta;
type Story = StoryObj<typeof meta>;
export const NewNote: Story = {};
export const EditBasic: Story = { args: { note: basic } };
export const EditImportedType: Story = { args: { note } };
export const English: Story = { args: { note, locale: "en" } };
export const Saving: Story = { args: { note: basic, busy: true } };
