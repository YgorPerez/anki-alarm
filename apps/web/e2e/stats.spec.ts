import { ALARM_EVENTS, newAlarm } from "@app/core";
import { expect, test } from "@playwright/test";

import { phoneWithDeck } from "./phone.ts";

test("the phone's alarm journal reaches the web's stats, drawn in the theme's colors", async ({
  page,
}) => {
  const bia = await phoneWithDeck("bia@example.com", "Palavras", [["casa", "house"]]);
  const start = Date.now() - 20 * 60_000;
  const event = (n: number, kind: string, at: number) => ({
    id: `e2e-stats-${n}`,
    kind,
    alarmId: "work",
    ringId: "ring-e2e",
    wallTime: at,
    elapsedRealtime: at - start + 1_000,
  });
  await bia.rang({ ...newAlarm("work"), label: "Work" }, [
    event(0, ALARM_EVENTS.ringStarted, start),
    event(1, ALARM_EVENTS.snoozed, start + 60_000),
    event(2, ALARM_EVENTS.dismissed, start + 9 * 60_000),
  ]);
  await bia.sync();

  await page.goto("/?lang=en");
  page.once("dialog", (dialog) => void dialog.accept("bia@example.com"));
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  await expect(page.getByText(/^Synced at/)).toBeVisible();
  await page.getByRole("link", { name: "Statistics" }).click();

  const work = page.getByRole("listitem", { name: "Work" });
  await expect(work).toContainText("Rang once");
  await expect(work).toContainText("9 min");
  await expect(page.getByRole("img", { name: "Forecast" })).toBeVisible();
  // The bars take the theme's CSS variables, which the browser resolves to the token's color: the
  // one new card is a bar in Easy's hue.
  const bar = page
    .getByRole("img", { name: "Cards by state" })
    .locator('[fill="var(--color-easy)"]');
  await expect(bar).toBeVisible();
  expect(await bar.evaluate((el) => getComputedStyle(el).fill)).toMatch(/^rgb/);
  await expect(page.getByRole("table", { name: "True retention" })).toBeVisible();
});
