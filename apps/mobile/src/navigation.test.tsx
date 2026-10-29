import { fireEvent, render, screen } from "@testing-library/react-native/pure";
import { expect, test } from "vite-plus/test";
import { TabBar, SettingsButton } from "./navigation.tsx";

test("three localized destinations mark the active tab and each header opens Settings", async () => {
  const visits: string[] = [];
  const view = (locale: "pt-BR" | "en", active: string) => (
    <>
      <SettingsButton locale={locale} onPress={() => visits.push("settings")} />
      <TabBar locale={locale} active={active} onSelect={(name) => visits.push(name)} bottom={0} />
    </>
  );
  const app = await render(view("pt-BR", "index"));
  expect(screen.getByRole("tab", { name: "Alarmes" }).props.accessibilityState.selected).toBe(true);
  await fireEvent.press(screen.getByRole("tab", { name: "Baralhos" }));
  await fireEvent.press(screen.getByRole("tab", { name: "Estatísticas" }));
  await fireEvent.press(screen.getByRole("button", { name: "Ajustes" }));
  expect(visits).toEqual(["decks", "stats", "settings"]);
  await app.rerender(view("en", "stats"));
  expect(screen.getByRole("tab", { name: "Stats" }).props.accessibilityState.selected).toBe(true);
  expect(screen.getByRole("tab", { name: "Alarms" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Decks" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
});
