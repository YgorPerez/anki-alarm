/* oxlint-disable eslint/no-await-in-loop -- A study session answers one card after another. */
import { expect, test, type Page } from "@playwright/test";

import { phone, phoneWithDeck } from "./phone.ts";

/** Dev sign-in: the web asks for the e-mail instead of going to Google. */
async function signIn(page: Page, email: string) {
  page.once("dialog", (dialog) => void dialog.accept(email));
  await page.getByRole("button", { name: "Sign in with Google" }).click();
}
const synced = (page: Page) => expect(page.getByText(/^Synced at/)).toBeVisible();

/** Shows each card's answer and grades it, as long as cards come. */
async function study(page: Page, grades: string[]) {
  for (const grade of grades) {
    await page.getByRole("button", { name: "Show answer" }).click();
    await page.getByRole("button", { name: grade, exact: true }).click();
  }
  await expect(page.getByText("No cards available now. Daily limits apply.")).toBeVisible();
}

const webReviews = async (device: Awaited<ReturnType<typeof phone>>) => {
  await device.sync();
  return (await device.reviewLog()).flatMap((e) =>
    e.kind === "review" && e.origin === "web" ? [e.grade] : [],
  );
};

test("a study session on the web reaches the phone", async ({ page }) => {
  const ana = await phoneWithDeck("ana@example.com", "Palavras", [
    ["casa", "house"],
    ["gato", "cat"],
  ]);
  await page.goto("/?lang=en");
  await signIn(page, "ana@example.com");
  await synced(page);
  const deck = page.getByRole("link", { name: /Palavras/ });
  await expect(deck).toContainText("2 due today");

  await deck.click();
  await expect(page.getByRole("heading", { name: "Palavras" })).toBeVisible();
  const front = page.frameLocator('iframe[title="Front"]');
  await expect(front.locator("body")).toContainText(/casa|gato/);
  await page.getByRole("button", { name: "Show answer" }).click();
  await expect(page.frameLocator('iframe[title="Back"]').locator("body")).toContainText(
    /house|cat/,
  );
  await page.getByRole("button", { name: "Good", exact: true }).click();
  await study(page, ["Easy"]);

  await expect.poll(() => webReviews(ana), { timeout: 20_000 }).toEqual([3, 4]);
});

test("studying offline keeps the reviews and syncs them when back online", async ({
  page,
  context,
}) => {
  const bia = await phoneWithDeck("bia@example.com", "Verbos", [
    ["ser", "to be"],
    ["ter", "to have"],
  ]);
  await page.goto("/?lang=en");
  await signIn(page, "bia@example.com");
  await synced(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), {
          once: true,
        }),
      );
  });

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText("Signed in as bia@example.com")).toBeVisible();
  await page.getByRole("link", { name: /Verbos/ }).click();
  await study(page, ["Hard", "Good"]);
  await page.getByRole("link", { name: "Back" }).click();
  await expect(page.getByText("No connection. Your reviews are kept and sync later.")).toBeVisible({
    timeout: 15_000,
  });
  expect(await webReviews(bia)).toEqual([]);

  await context.setOffline(false);
  await expect.poll(() => webReviews(bia), { timeout: 20_000 }).toEqual([2, 3]);
  await synced(page);
});

test("a second account asks before merging this browser's data, and cancel keeps them apart", async ({
  page,
}) => {
  const caio = await phoneWithDeck("caio@example.com", "Caio's deck", [["um", "one"]]);
  const dani = await phoneWithDeck("dani@example.com", "Dani's deck", [["dois", "two"]]);
  await page.goto("/?lang=en");
  await signIn(page, "caio@example.com");
  await synced(page);
  await expect(page.getByRole("link", { name: /Caio's deck/ })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  // Signing out keeps this browser's data.
  await expect(page.getByRole("link", { name: /Caio's deck/ })).toBeVisible();
  await signIn(page, "dani@example.com");
  await expect(page.getByText("This isn't the account last used in this browser")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
  await dani.sync();
  expect(await dani.deckNames()).toEqual(["Dani's deck"]);

  await signIn(page, "dani@example.com");
  await page.getByRole("button", { name: "Merge into this account" }).click();
  await synced(page);
  await expect(page.getByRole("link", { name: /Dani's deck/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Caio's deck/ })).toBeVisible();
  await dani.sync();
  expect(new Set(await dani.deckNames())).toEqual(new Set(["Dani's deck", "Caio's deck"]));
  // The first account only ever gets its own data.
  await caio.sync();
  expect(await caio.deckNames()).toEqual(["Caio's deck"]);
});
