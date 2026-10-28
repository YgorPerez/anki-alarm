import { composeStories } from "@storybook/react-vite";
import { expect, test } from "vite-plus/test";
import * as stories from "./button.stories.tsx";

for (const [name, story] of Object.entries(composeStories(stories))) {
  test(`story ${name}`, async () => {
    await expect(story.run()).resolves.toBeUndefined();
  });
}
