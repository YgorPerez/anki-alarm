import { useState } from "react";
import { Pressable, Text } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native/pure";
import { expect, test } from "vite-plus/test";
import { navigationRenderer } from "./navigation-renderer.tsx";

function Header({ title }: { title: string }) {
  const [opened, setOpened] = useState(false);
  return (
    <Pressable accessibilityRole="button" onPress={() => setOpened(true)}>
      <Text>{opened ? "Settings opened" : title}</Text>
    </Pressable>
  );
}

test("navigation render callbacks can produce headers that use hooks", async () => {
  const headerRight = navigationRenderer(Header);
  // Navigators invoke render callbacks as ordinary functions, including outside component render.
  const header = headerRight({ title: "Settings" });
  await render(header);
  await fireEvent.press(screen.getByRole("button", { name: "Settings" }));
  expect(screen.getByText("Settings opened")).toBeTruthy();
});
