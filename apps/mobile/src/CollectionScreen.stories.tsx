import type { Meta, StoryObj } from "@storybook/react-native";
import { CollectionScreen } from "./CollectionScreen.tsx";
const meta = {
  title: "Collection",
  component: CollectionScreen,
  args: { locale: "pt-BR", onExit: () => {}, onTheme: () => {} },
} satisfies Meta<typeof CollectionScreen>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Portuguese: Story = {};
export const English: Story = { args: { locale: "en" } };
