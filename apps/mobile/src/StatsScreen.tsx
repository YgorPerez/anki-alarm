import { PillChip } from "./PillChip.tsx";
import { studyStats, wakeUpStats, type Locale, type StudyStats, type Theme } from "@app/core";
import {
  STATS_PERIODS,
  statsCopy,
  studySections,
  wakeUpScopes,
  type StatsCopy,
} from "@app/stats-ui";
import { useQuery } from "@tanstack/react-query";
import { Effect } from "effect";
import { useEffect, useState, type ReactNode } from "react";
import { BackHandler, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { localData } from "./database.ts";
import { GradeLegend, RetentionTable, StatsChart } from "./StatsCharts.tsx";
import { WakeUpSection } from "./WakeUpStats.tsx";

const regular = { fontFamily: "AtkinsonHyperlegible_400Regular" };
const bold = { fontFamily: "AtkinsonHyperlegible_700Bold" };

export function StatsScreen({
  locale,
  theme,
  onExit,
}: {
  locale: Locale;
  /** The derived theme of the mode on screen, for chart paint. */
  theme: Theme;
  onExit?: () => void;
}) {
  const t = statsCopy(locale);
  const insets = useSafeAreaInsets();
  const [deckId, setDeckId] = useState<string>();
  const [days, setDays] = useState(30);
  const query = useQuery({
    queryKey: ["stats"],
    networkMode: "always",
    queryFn: async () => ({
      ...(await Effect.runPromise(
        localData((data) =>
          Effect.all({
            collection: data.collection,
            log: data.reviewLog,
            alarms: data.alarms,
            events: data.events,
          }),
        ),
      )),
      now: Date.now(),
    }),
  });
  useEffect(() => {
    if (!onExit) return undefined;
    const handler = BackHandler.addEventListener("hardwareBackPress", () => {
      onExit();
      return true;
    });
    return () => handler.remove();
  }, [onExit]);
  const data = query.data;
  const stats = data
    ? studyStats(data.collection, data.log, { now: data.now, deckId, days })
    : undefined;
  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <ScrollView contentContainerClassName="gap-6 px-6 pb-6">
        {onExit && <PillChip label={t("back")} onPress={onExit} />}
        <Text accessibilityRole="header" style={bold} className="text-title text-foreground">
          {t("stats")}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          <PillChip label={t("allDecks")} selected={!deckId} onPress={() => setDeckId(undefined)} />
          {data?.collection.decks.map((deck) => (
            <PillChip
              key={deck.id}
              label={deck.fields.name.value}
              selected={deck.id === deckId}
              onPress={() => setDeckId(deck.id)}
            />
          ))}
        </View>
        <View className="flex-row flex-wrap gap-2">
          {STATS_PERIODS.map((period) => (
            <PillChip
              key={period.days}
              label={t(period.label)}
              selected={period.days === days}
              onPress={() => setDays(period.days)}
            />
          ))}
        </View>
        {data && !deckId ? (
          <Section title={t("wakeUp")} hint={t("wakeUpHint")}>
            <WakeUpSection
              scopes={wakeUpScopes(
                wakeUpStats(data.events, data.log, { now: data.now, days }),
                data.alarms,
                t,
                locale,
              )}
              t={t}
            />
          </Section>
        ) : null}
        {stats ? (
          <Sections stats={stats} t={t} theme={theme} locale={locale} />
        ) : query.isError ? (
          <>
            <Text accessibilityRole="alert" style={regular} className="text-body text-destructive">
              {t("loadError")}
            </Text>
            <PillChip
              label={t("retry")}
              onPress={() => {
                void query.refetch();
              }}
            />
          </>
        ) : (
          <Text style={regular} className="text-body text-muted-foreground">
            {t("loading")}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

function Section({
  title,
  hint = null,
  children,
}: {
  title: string;
  hint?: string | null;
  children: ReactNode;
}) {
  return (
    <View className="gap-3">
      <Text accessibilityRole="header" style={bold} className="text-body text-foreground">
        {title}
      </Text>
      {hint ? (
        <Text style={regular} className="text-label text-muted-foreground">
          {hint}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

function Sections({
  stats,
  t,
  theme,
  locale,
}: {
  stats: StudyStats;
  t: StatsCopy;
  theme: Theme;
  locale: Locale;
}) {
  return studySections(stats, t).map((section) => (
    <Section key={section.title} title={section.title} hint={section.hint}>
      {section.notice ? (
        <Text style={regular} className="text-body text-muted-foreground">
          {section.notice}
        </Text>
      ) : null}
      {section.body.kind === "retention" ? (
        <RetentionTable table={section.body.table} />
      ) : (
        <StatsChart chart={section.body} theme={theme} locale={locale} />
      )}
      {section.legend ? <GradeLegend t={t} theme={theme} /> : null}
    </Section>
  ));
}
