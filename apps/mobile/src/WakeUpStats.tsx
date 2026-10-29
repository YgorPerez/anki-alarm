import type { WakeUpScope, StatsCopy } from "@app/stats-ui";
import { Text, View } from "react-native";

const regular = { fontFamily: "AtkinsonHyperlegible_400Regular" };
const bold = { fontFamily: "AtkinsonHyperlegible_700Bold" };

/** Wake-up stats: every alarm together, then each alarm that rang or was missed. */
export function WakeUpSection({ scopes, t }: { scopes: readonly WakeUpScope[]; t: StatsCopy }) {
  if (scopes.length === 0)
    return (
      <Text style={regular} className="text-body text-muted-foreground">
        {t("noRings")}
      </Text>
    );
  return (
    <>
      {scopes.map((scope) => (
        <View
          key={scope.key}
          accessibilityLabel={scope.name}
          className="gap-1 rounded-lg bg-surface p-4"
        >
          <View className="flex-row items-baseline justify-between gap-3">
            <Text style={bold} className="flex-1 text-body text-foreground">
              {scope.name}
            </Text>
            <Text style={regular} className="text-label text-muted-foreground tabular-nums">
              {scope.rang}
            </Text>
          </View>
          {scope.rows.map((row) => (
            <View key={row.label} className="min-h-10 flex-row items-center justify-between gap-3">
              <Text style={regular} className="flex-1 text-label text-muted-foreground">
                {row.label}
              </Text>
              <Text style={bold} className="text-body text-foreground tabular-nums">
                {row.value}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </>
  );
}
