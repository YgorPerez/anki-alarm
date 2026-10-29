import { fireEvent, render, screen } from "@testing-library/react-native/pure";
import { expect, test } from "vite-plus/test";
import { Text } from "react-native";
import { SettingsScreen } from "./SettingsScreen.tsx";

test("Settings groups reliability, theme, language, account and updates in both languages", async () => {
  const actions: string[] = [];
  const view = (locale: "pt-BR" | "en") => (
    <SettingsScreen
      locale={locale}
      onReliability={() => actions.push("reliability")}
      onTheme={() => actions.push("theme")}
      switchLanguage={() => actions.push("language")}
      account={<Text>Account status</Text>}
      update={<Text>Update offer</Text>}
    />
  );
  const result = await render(view("pt-BR"));
  await fireEvent.press(screen.getByRole("button", { name: "Confiabilidade dos alarmes" }));
  await fireEvent.press(screen.getByRole("button", { name: "Tema" }));
  await fireEvent.press(screen.getByRole("button", { name: "English" }));
  expect(actions).toEqual(["reliability", "theme", "language"]);
  expect(screen.getByText("Account status")).toBeTruthy();
  expect(screen.getByText("Update offer")).toBeTruthy();
  await result.rerender(view("en"));
  expect(screen.getByRole("header", { name: "Settings" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Alarm reliability" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Theme" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Português" })).toBeTruthy();
});
