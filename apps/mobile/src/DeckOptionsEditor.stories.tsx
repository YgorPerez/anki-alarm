import type { Meta, StoryObj } from "@storybook/react-native";
import { DeckOptionsEditor } from "./DeckOptionsEditor.tsx";
import { editorFixture } from "./editor-fixtures.ts";

const { state } = editorFixture();
const meta = {
  title: "Editing/Deck options",
  component: DeckOptionsEditor,
  args: {
    preset: state.presets[0]!,
    deckCount: 1,
    locale: "pt-BR",
    busy: false,
    onSave: () => {},
    onCancel: () => {},
  },
} satisfies Meta<typeof DeckOptionsEditor>;
export default meta;
type Story = StoryObj<typeof meta>;
export const OneDeck: Story = {};
export const SharedPreset: Story = { args: { deckCount: state.decks.length } };
export const English: Story = { args: { locale: "en" } };
