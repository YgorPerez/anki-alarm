import type { Meta, StoryObj } from "@storybook/react-native";
import { FACTORY_THEME, themeFor } from "@app/core";
import { StatsScreen } from "./StatsScreen.tsx";
const meta = {
  title: "Stats",
  component: StatsScreen,
  args: { locale: "pt-BR", theme: themeFor(FACTORY_THEME, "light"), onExit: () => {} },
} satisfies Meta<typeof StatsScreen>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Portuguese: Story = {};
export const English: Story = { args: { locale: "en" } };
