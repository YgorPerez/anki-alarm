import { navigationRenderer } from "../../navigation-renderer.tsx";
import { Tabs, useRouter } from "expo-router";
import type { BottomTabBarProps } from "expo-router/tabs";
import { useUI } from "../../ui.ts";
import { bold } from "../../fonts.ts";
import { SettingsButton, TabBar, tabLabels } from "../../navigation.tsx";
import { useNavigationTheme } from "../../navigation-theme.ts";

function SettingsGear() {
  const router = useRouter();
  const { locale } = useUI();
  const theme = useNavigationTheme();
  return (
    <SettingsButton
      locale={locale}
      color={theme.foreground}
      onPress={() => router.push("/settings")}
    />
  );
}
function AppTabBar({ state, emitter, navigateToTab, insets }: BottomTabBarProps) {
  const colors = useNavigationTheme();
  return (
    <TabBar
      colors={colors}
      locale={useUI().locale}
      active={state.routes[state.index]!.name}
      bottom={insets.bottom}
      onSelect={(name) => {
        const route = state.routes.find((item) => item.name === name)!;
        const event = emitter.emit({
          type: "tabPress",
          target: route.key,
          canPreventDefault: true,
        });
        if (!event.defaultPrevented) navigateToTab(route.key);
      }}
    />
  );
}
const renderSettingsGear = navigationRenderer(SettingsGear);
const renderTabBar = navigationRenderer(AppTabBar);

export default function TabLayout() {
  const theme = useNavigationTheme();
  const titles = tabLabels(useUI().locale);
  return (
    <Tabs
      backBehavior="none"
      screenOptions={{
        headerTitleAlign: "left",
        headerTitleStyle: { ...bold, fontSize: 30, color: theme.foreground },
        headerShadowVisible: false,
        headerStyle: { backgroundColor: theme.background },
        headerRight: renderSettingsGear,
      }}
      tabBar={renderTabBar}
    >
      <Tabs.Screen name="index" options={{ title: titles.index }} />
      <Tabs.Screen name="decks" options={{ title: titles.decks }} />
      <Tabs.Screen name="stats" options={{ title: titles.stats }} />
    </Tabs>
  );
}
