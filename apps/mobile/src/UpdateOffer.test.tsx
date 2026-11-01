import { fireEvent, render, screen } from "@testing-library/react-native/pure";
import { expect, test } from "vite-plus/test";
import { UpdateCard, UpdateOfferButton } from "./UpdateOffer.tsx";
import { showsUpdateCard } from "./update-store.ts";
import type { ApkDownload } from "./update-store.ts";

const apkOffer = (download: ApkDownload) =>
  ({
    kind: "apk",
    apk: { version: "0.7.0", url: "https://example.com/a.apk", size: 131_162_716 },
    download,
  }) as const;

const settingsButton = (download: ApkDownload) => (
  <UpdateOfferButton offer={apkOffer(download)} locale="en" onAccept={() => {}} />
);

test.each([
  ["/", true],
  ["/decks", true],
  ["/stats", true],
  ["/settings/theme", true],
  ["/settings/reliability", true],
  ["/settings", false],
  ["/study/deck-1", false],
  ["/alarm/new", false],
  ["/ankidroid", false],
])("the card on %s: %s", (pathname, shown) => {
  expect(showsUpdateCard(pathname)).toBe(shown);
});

test("the card offers the APK with its size, and tapping or dismissing it reports back", async () => {
  const actions: string[] = [];
  await render(
    <UpdateCard
      offer={apkOffer({ kind: "idle" })}
      locale="pt-BR"
      bottom={0}
      onAccept={() => actions.push("accept")}
      onDismiss={() => actions.push("dismiss")}
    />,
  );
  await fireEvent.press(
    screen.getByRole("button", { name: "Nova versão 0.7.0. Baixar e instalar (131 MB)" }),
  );
  await fireEvent.press(screen.getByRole("button", { name: "Dispensar atualização" }));
  expect(actions).toEqual(["accept", "dismiss"]);
});

test("a downloading card shows the percentage and can't be dismissed", async () => {
  await render(
    <UpdateCard
      offer={apkOffer({ kind: "downloading", percent: 42 })}
      locale="en"
      bottom={0}
      onAccept={() => {}}
      onDismiss={() => {}}
    />,
  );
  expect(screen.getByText("Downloading… 42%")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Dismiss update" })).toBeNull();
});

test("the card asks to restart for a downloaded OTA", async () => {
  await render(
    <UpdateCard
      offer={{ kind: "ota", failed: false }}
      locale="pt-BR"
      bottom={0}
      onAccept={() => {}}
      onDismiss={() => {}}
    />,
  );
  expect(screen.getByText("Reiniciar para atualizar")).toBeTruthy();
});

test("the Settings button has no dismiss, reopens the installer and explains failures", async () => {
  const result = await render(settingsButton({ kind: "ready", file: "file:///a" }));
  expect(screen.getByRole("button", { name: "Install" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Dismiss update" })).toBeNull();
  await result.rerender(settingsButton({ kind: "failed" }));
  expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  expect(screen.getByRole("alert")).toBeTruthy();
});
