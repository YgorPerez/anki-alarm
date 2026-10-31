import { regular } from "../../fonts.ts";
import { navigationRenderer } from "../../navigation-renderer.tsx";
import { Stack, useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlobalUpdateCard } from "../../app-update.tsx";
import { useUI } from "../../ui.ts";
import { copy } from "../../copy.ts";
import { useNavigationTheme } from "../../navigation-theme.ts";

function BackButton() {
  const router = useRouter();
  const t = copy(useUI().locale);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("back")}
      onPress={() => router.back()}
      className="min-h-12 min-w-12 justify-center"
    >
      <Text style={regular} className="text-body text-primary-ink">
        {t("back")}
      </Text>
    </Pressable>
  );
}
const renderBackButton = navigationRenderer(BackButton);

export default function SettingsLayout() {
  const theme = useNavigationTheme();
  const { bottom } = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-background">
      <Stack
        screenOptions={{
          title: "",
          headerLeft: renderBackButton,
          headerTintColor: theme.foreground,
          headerStyle: { backgroundColor: theme.background },
          contentStyle: { backgroundColor: theme.background },
          headerShadowVisible: false,
        }}
      />
      <GlobalUpdateCard bottom={bottom} />
    </View>
  );
}
