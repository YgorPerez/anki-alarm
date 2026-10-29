import { composeStories } from "@storybook/react-vite";
import { expect, test } from "vite-plus/test";

import * as browser from "./card-browser.stories.tsx";
import * as deckOptions from "./deck-options-editor.stories.tsx";
import * as note from "./note-editor.stories.tsx";
import * as noteType from "./note-type-editor.stories.tsx";

const stories = [
  ...Object.entries(composeStories(browser)),
  ...Object.entries(composeStories(deckOptions)),
  ...Object.entries(composeStories(note)),
  ...Object.entries(composeStories(noteType)),
];
for (const [name, story] of stories)
  test(`story ${name}`, async () => {
    await expect(story.run()).resolves.toBeUndefined();
  });
