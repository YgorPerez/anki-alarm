import { screen } from "@testing-library/react";
import { describe, expect, test } from "vite-plus/test";

import { renderRoute } from "../../test/render.tsx";

describe("home", () => {
  test("opens in Portuguese and switches to English", async () => {
    const { user } = await renderRoute("/");

    expect(await screen.findByRole("heading", { name: "Anki Alarm" })).toBeDefined();

    await user.click(screen.getByRole("button", { name: "English" }));

    expect(await screen.findByRole("heading", { name: "Alarm clock" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Português" })).toBeDefined();
  });
});
