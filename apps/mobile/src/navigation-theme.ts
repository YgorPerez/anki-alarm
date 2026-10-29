import { themeFor } from "@app/core";
import { useColorScheme } from "react-native";
import { useThemeChoice } from "./theme.ts";

export function useNavigationTheme() {
  const scheme = useColorScheme();
  return themeFor(useThemeChoice(), scheme === "dark" ? "dark" : "light");
}
