import type { Meta, StoryObj } from "@storybook/react-native";
import fixture from "../../../packages/core/fixtures/ankidroid-deck.json" with { type: "json" };
import { memoryAnkiDroid } from "./ankidroid.ts";
import { AnkiDroidScreen } from "./AnkiDroidScreen.tsx";
const meta = {
  title: "AnkiDroid",
  component: AnkiDroidScreen,
  args: {
    locale: "pt-BR",
    onExit: () => {},
    onOpen: () => {},
    ankiDroid: memoryAnkiDroid({
      installed: { versionCode: 22500300, permission: "granted" },
      decks: fixture.decks,
      sources: [fixture.source],
      media: 3,
    }),
  },
} satisfies Meta<typeof AnkiDroidScreen>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Decks: Story = {};
export const NotInstalled: Story = { args: { ankiDroid: memoryAnkiDroid({ installed: null }) } };
export const Permission: Story = {
  args: {
    locale: "en",
    ankiDroid: memoryAnkiDroid({ installed: { versionCode: 22500300, permission: "denied" } }),
  },
};
