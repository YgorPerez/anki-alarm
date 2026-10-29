import type { Meta, StoryObj } from "@storybook/react-native";
import { CardActions } from "./CardActions.tsx";
import { editorFixture } from "./editor-fixtures.ts";

const { state, card, note, memory } = editorFixture();
const meta = {
  title: "Editing/Card actions",
  component: CardActions,
  args: {
    cards: [card],
    memory,
    locale: "pt-BR",
    busy: false,
    onForget: () => {},
    onSetDueDate: () => {},
  },
} satisfies Meta<typeof CardActions>;
export default meta;
type Story = StoryObj<typeof meta>;
export const StudiedCard: Story = {};
export const NewCard: Story = {
  args: { cards: state.cards.filter((c) => c.fields.noteId.value === note.id) },
};
export const English: Story = { args: { locale: "en" } };
