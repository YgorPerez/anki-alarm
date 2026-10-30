import { Stack } from "expo-router";
import { App } from "../App.tsx";
import { useNavigationTheme } from "../navigation-theme.ts";

export default function RootLayout() {
  return (
    <App>
      <Routes />
    </App>
  );
}
function Routes() {
  const theme = useNavigationTheme();
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.background } }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="settings" />
    </Stack>
  );
}
