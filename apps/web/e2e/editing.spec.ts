import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

const fixture = join(import.meta.dirname, "../../../packages/core/fixtures/apkg/latest.apkg");

test("an .apkg imports in the browser's database, edits keep after a reload, and a deck exports", async ({
  page,
}) => {
  await page.goto("/?lang=en");
  // The service worker serves card media from the browser's storage.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), {
          once: true,
        }),
      );
  });
  await page.getByLabel("Import .apkg").setInputFiles(fixture);
  await expect(page.getByText(/^Imported: \d+ notes, \d+ cards and \d+ reviews\.$/)).toBeVisible();
  const media = await page.evaluate(async () => {
    const response = await fetch("/media/gato.png");
    return { ok: response.ok, size: (await response.arrayBuffer()).byteLength };
  });
  expect(media).toEqual({ ok: true, size: expect.any(Number) });
  expect(media.size).toBeGreaterThan(0);

  // Edit a note from the browser; it saves as you type and is there after a reload.
  await page.getByRole("link", { name: "Card browser" }).click();
  await page.getByRole("searchbox", { name: "Search" }).fill("deck:português::verbos");
  const cards = page.getByRole("list", { name: "Cards" });
  await cards.getByRole("button").first().click();
  const field = page.getByRole("textbox").nth(1);
  await field.fill("edited on the web");
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  await page.reload();
  await cards.getByRole("button").first().click();
  await expect(page.getByRole("textbox").nth(1)).toHaveValue("edited on the web");

  // A note type's CSS shows in the preview and saves.
  await page.goto("/note-types?lang=en");
  await page.getByLabel("Styling (CSS)").fill(".card { color: teal }");
  await expect(page.locator('iframe[title="Front preview"]')).toHaveAttribute(
    "srcdoc",
    /color: teal/,
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();

  // The deck exports with its media, through the browser's download.
  await page.goto("/?lang=en");
  await page.getByRole("link", { name: "Edit Português::Verbos" }).click();
  await page.getByRole("button", { name: "Deck options" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export .apkg" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("Português - Verbos.apkg");
  const zip = unzipSync(new Uint8Array(await readFile(await file.path())));
  expect(Object.keys(zip)).toContain("collection.anki21");
  expect(Object.values(JSON.parse(strFromU8(zip["media"])))).toContain("gato.png");
});
