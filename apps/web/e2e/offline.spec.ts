import { expect, test } from "@playwright/test";

test("theme edits survive an offline reload without localStorage", async ({ page, context }) => {
  await page.goto("/settings/theme?lang=en");
  await page
    .getByRole("group", { name: "Primary", exact: true })
    .getByRole("radio", { name: "#7fd4ff", exact: true })
    .locator("..")
    .click();
  await expect(
    page
      .getByRole("group", { name: "Primary", exact: true })
      .getByRole("radio", { name: "#7fd4ff", exact: true }),
  ).toBeChecked();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), {
          once: true,
        }),
      );
    localStorage.clear();
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Theme", exact: true })).toBeVisible();
  await expect(
    page
      .getByRole("group", { name: "Primary", exact: true })
      .getByRole("radio", { name: "#7fd4ff", exact: true }),
  ).toBeChecked();
});

test("two tabs share committed settings and a follower takes over after the leader closes", async ({
  page,
  context,
}) => {
  await page.goto("/settings/theme?lang=en");
  const radio = (tab: typeof page, field: string, color: string) =>
    tab
      .getByRole("group", { name: field, exact: true })
      .getByRole("radio", { name: color, exact: true });
  await expect(radio(page, "Primary", "#c9b6ff")).toBeChecked();
  const follower = await context.newPage();
  await follower.goto("/settings/theme?lang=en");
  await expect(radio(follower, "Primary", "#c9b6ff")).toBeChecked();
  await radio(follower, "Primary", "#7fd4ff").locator("..").click();
  await expect(radio(page, "Primary", "#7fd4ff")).toBeChecked();
  await radio(page, "Secondary", "#ffd166").locator("..").click();
  await expect(radio(follower, "Secondary", "#ffd166")).toBeChecked();
  await page.close();
  await radio(follower, "Primary", "#8be3a0").locator("..").click();
  await expect(radio(follower, "Primary", "#8be3a0")).toBeChecked();
  await follower.reload();
  await expect(radio(follower, "Primary", "#8be3a0")).toBeChecked();
  await expect(radio(follower, "Secondary", "#ffd166")).toBeChecked();
});

test("sync and authentication responses never enter the shell cache", async ({ page, context }) => {
  await page.goto("/?lang=en");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), {
          once: true,
        }),
      );
    await Promise.all(["/sync", "/sync/pull", "/api/auth/get-session"].map((path) => fetch(path)));
  });
  await context.setOffline(true);
  expect(
    await page.evaluate(async () => {
      const results = await Promise.all(
        ["/sync", "/sync/pull", "/api/auth/get-session"].map(async (path) => {
          try {
            await fetch(path);
            return "cached";
          } catch {
            return "offline";
          }
        }),
      );
      const cached = (
        await Promise.all(
          (await caches.keys()).map(async (key) =>
            (await (await caches.open(key)).keys()).map((request) => new URL(request.url).pathname),
          ),
        )
      ).flat();
      return {
        results,
        apiCached: cached.some((path) => path.startsWith("/sync") || path.startsWith("/api")),
      };
    }),
  ).toEqual({ results: ["offline", "offline", "offline"], apiCached: false });
});

test("storage refusal is visible instead of silently switching to memory", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator.storage, "getDirectory", { value: undefined }),
  );
  await page.goto("/?lang=en");
  await expect(page.getByRole("alert")).toContainText("Could not access local storage");
});
