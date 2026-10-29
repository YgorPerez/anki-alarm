import { act, render, screen } from "@testing-library/react-native/pure";
import { expect, test } from "vite-plus/test";
import { Text } from "react-native";
import { pressBack } from "../test/native/react-native.ts";
import { NavigationGate } from "./NavigationGate.tsx";

test.each(["Ringing", "Awake check"])(
  "%s hides navigation and consumes Back until it ends",
  async (takeover) => {
    const app = await render(
      <NavigationGate takeover={null}>
        <Text>Tabs and Settings</Text>
      </NavigationGate>,
    );
    expect(screen.getByText("Tabs and Settings")).toBeTruthy();
    await app.rerender(
      <NavigationGate takeover={<Text>{takeover}</Text>}>
        <Text>Tabs and Settings</Text>
      </NavigationGate>,
    );
    expect(screen.queryByText("Tabs and Settings")).toBeNull();
    await act(async () => {
      expect(pressBack()).toBe(true);
    });
    expect(screen.getByText(takeover)).toBeTruthy();
    await app.rerender(
      <NavigationGate takeover={null}>
        <Text>Tabs and Settings</Text>
      </NavigationGate>,
    );
    expect(pressBack()).toBe(false);
    expect(screen.getByText("Tabs and Settings")).toBeTruthy();
  },
);
