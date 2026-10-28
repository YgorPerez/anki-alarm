import {
  studyStats,
  wakeUpStats,
  type Bucket,
  type Locale,
  type StudyStats,
  type Theme,
} from "@app/core";
import { useQuery } from "@tanstack/react-query";
import { Effect } from "effect";
import { useEffect, useState, type ReactNode } from "react";
import { BackHandler, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { localData } from "./database.ts";
import { CountChart, GradeChart, GradeLegend, RetentionTable } from "./StatsCharts.tsx";
import { statsCopy, type StatsCopy } from "./stats-copy.ts";
import { WakeUpSection } from "./WakeUpStats.tsx";

const regular = { fontFamily: "AtkinsonHyperlegible_400Regular" };
const bold = { fontFamily: "AtkinsonHyperlegible_700Bold" };
const PERIODS = [
  { days: 30, label: "month" },
  { days: 90, label: "quarter" },
  { days: 365, label: "year" },
] as const;

export function StatsScreen({
  locale,
  theme,
  onExit,
}: {
  locale: Locale;
  /** The derived theme of the mode on screen, for chart paint. */
  theme: Theme;
  onExit: () => void;
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
      <ScrollView contentContainerClassName="gap-6 p-6">
        <Chip label={t("back")} onPress={onExit} />
        <Text accessibilityRole="header" style={bold} className="text-title text-foreground">
          {t("stats")}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          <Chip label={t("allDecks")} selected={!deckId} onPress={() => setDeckId(undefined)} />
          {data?.collection.decks.map((deck) => (
            <Chip
              key={deck.id}
              label={deck.fields.name.value}
              selected={deck.id === deckId}
              onPress={() => setDeckId(deck.id)}
            />
          ))}
        </View>
        <View className="flex-row flex-wrap gap-2">
          {PERIODS.map((period) => (
            <Chip
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
              stats={wakeUpStats(data.events, data.log, { now: data.now, days })}
              alarms={data.alarms}
              t={t}
              locale={locale}
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
            <Chip
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

function Chip({
  label,
  selected = false,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`min-h-12 justify-center self-start rounded-full px-5 active:opacity-80 ${selected ? "bg-primary-tint" : "bg-surface"}`}
    >
      <Text
        style={selected ? bold : regular}
        className={`text-body ${selected ? "text-primary-ink" : "text-foreground"}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
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

const span = ({ from, to }: Bucket) =>
  to === null ? `${from}+` : to - from === 1 ? String(from) : `${from}–${to - 1}`;
const tenth = ({ from }: Bucket) => `${Math.round(from * 100)}%`;
const buckets = (list: readonly Bucket[], fill: string) =>
  list.map((bucket, x) => ({ x, n: bucket.count, fill }));

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
  const answered = stats.reviews.some((d) => d.again + d.hard + d.good + d.easy > 0);
  const states = [
    ["new", theme.easy],
    ["learning", theme.again],
    ["relearning", theme.again],
    ["young", theme.primary],
    ["mature", theme.primary],
  ] as const;
  const neutral = theme["muted-foreground"];
  const chart = { theme, locale };
  return (
    <>
      <Section title={t("reviews")} hint={t("reviewsHint")}>
        {answered ? null : (
          <Text style={regular} className="text-body text-muted-foreground">
            {t("noReviews")}
          </Text>
        )}
        <GradeChart
          label={t("reviews")}
          rows={stats.reviews.map(({ day, again, hard, good, easy }) => ({
            x: day,
            again,
            hard,
            good,
            easy,
          }))}
          format={(day) => (day === 0 ? t("today") : String(day))}
          {...chart}
        />
        <GradeLegend t={t} theme={theme} />
      </Section>
      <Section title={t("forecast")} hint={t("forecastHint")}>
        <CountChart
          label={t("forecast")}
          rows={stats.forecast.map(({ day, due }) => ({ x: day, n: due, fill: theme.primary }))}
          format={(day) => (day === 0 ? t("today") : `+${day}`)}
          {...chart}
        />
      </Section>
      <Section title={t("retention")} hint={t("retentionHint")}>
        <RetentionTable rows={stats.retention} t={t} />
      </Section>
      <Section title={t("counts")}>
        <CountChart
          label={t("counts")}
          rows={states.map(([state, fill], x) => ({ x, n: stats.counts[state], fill }))}
          format={(x) => {
            const state = states[x]?.[0];
            return state ? `${t(state)} ${stats.counts[state]}` : "";
          }}
          {...chart}
        />
      </Section>
      <Section title={t("intervals")} hint={t("intervalsHint")}>
        <CountChart
          label={t("intervals")}
          rows={buckets(stats.intervals, neutral)}
          format={(x) => (stats.intervals[x] ? span(stats.intervals[x]) : "")}
          {...chart}
        />
      </Section>
      <Section title={t("hours")} hint={t("hoursHint")}>
        <GradeChart
          label={t("hours")}
          rows={stats.hours.map(({ hour, again, hard, good, easy }) => ({
            x: hour,
            again,
            hard,
            good,
            easy,
          }))}
          format={(hour) => `${hour}h`}
          {...chart}
        />
      </Section>
      <Section title={t("stability")} hint={t("stabilityHint")}>
        <CountChart
          label={t("stability")}
          rows={buckets(stats.stability, neutral)}
          format={(x) => (stats.stability[x] ? span(stats.stability[x]) : "")}
          {...chart}
        />
      </Section>
      <Section title={t("difficulty")} hint={t("difficultyHint")}>
        <CountChart
          label={t("difficulty")}
          rows={buckets(stats.difficulty, neutral)}
          format={(x) => (stats.difficulty[x] ? tenth(stats.difficulty[x]) : "")}
          {...chart}
        />
      </Section>
      <Section title={t("retrievability")} hint={t("retrievabilityHint")}>
        <CountChart
          label={t("retrievability")}
          rows={buckets(stats.retrievability, neutral)}
          format={(x) => (stats.retrievability[x] ? tenth(stats.retrievability[x]) : "")}
          {...chart}
        />
      </Section>
    </>
  );
}
