import { useAlarmDeletion } from "./useAlarmDeletion.ts";
import { useQuickAlarmNotice } from "./useQuickAlarmNotice.ts";
import { SwipeAlarm } from "./SwipeAlarm.tsx";
import { Button } from "./controls.tsx";
import { AlarmCardMenu } from "./AlarmCardMenu.tsx";
import {
  nextAlarmRing,
  skipNextRing,
  skipOffer,
  undoSkip,
  upcomingRing,
  timeLeft,
  QUICK_ALARM_MINUTES,
  EVERY_DAY,
  type Alarm,
  type Locale,
} from "@app/core";
import { useRef, type ReactNode } from "react";
import { FlatList, Pressable, Switch, Text, View, useWindowDimensions } from "react-native";
import { useNow } from "./clock.tsx";
import { clockText, durationText, repeatSummary, timeText, weekdayName } from "./alarm-text.ts";
import { bold, clock, regular } from "./fonts.ts";
import { copy } from "./copy.ts";
import { HomeEmptyState, type DeckSetup } from "./HomeEmptyState.tsx";

type Deck = { id: string; name: string };

function dayText(at: number, locale: Locale, zone: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(at);
}

/** The card menu: skip or undo the next ring when that's on offer, and duplicate. */
function alarmMenuItems(
  alarm: Alarm,
  {
    offer,
    locale,
    now,
    zone,
    onSkip,
    onDuplicate,
    onDelete,
  }: {
    offer: ReturnType<typeof skipOffer>;
    locale: Locale;
    now: number;
    zone: string;
    onSkip?: (alarm: Alarm) => void;
    onDuplicate?: (alarm: Alarm) => void;
    onDelete?: () => void;
  },
) {
  const t = copy(locale);
  const items: { label: string; onPress: () => void; destructive?: boolean }[] = [];
  if (onSkip && offer === "skip")
    items.push({ label: t("skipNext"), onPress: () => onSkip(skipNextRing(alarm, now, zone)) });
  if (onSkip && offer === "undo")
    items.push({ label: t("undoSkip"), onPress: () => onSkip(undoSkip(alarm)) });
  if (onDuplicate) items.push({ label: t("duplicateAlarm"), onPress: () => onDuplicate(alarm) });
  if (onDelete) items.push({ label: t("deleteAlarm"), onPress: onDelete, destructive: true });
  return items;
}

function AlarmCardDetails({
  alarm,
  deckName,
  locale,
  ringsAfterSkip,
  zone,
}: {
  alarm: Alarm;
  deckName?: string;
  locale: Locale;
  ringsAfterSkip: number | null;
  zone: string;
}) {
  const t = copy(locale);
  return (
    <>
      {ringsAfterSkip !== null && (
        <Text style={regular} className="text-label text-attention">
          {t("skippedUntil", { date: dayText(ringsAfterSkip, locale, zone) })}
        </Text>
      )}
      <Text style={regular} numberOfLines={1} className="text-label text-muted-foreground">
        {alarm.label || deckName || t("chooseDeck")} ·{" "}
        {alarm.need === 1 ? t("oneCard") : t("needCount", { count: String(alarm.need) })}
      </Text>
    </>
  );
}

function AlarmCard({
  alarm,
  deckName,
  locale,
  now,
  zone,
  use24Hour,
  onEdit,
  onToggle,
  onSkip,
  onDuplicate,
  onDelete,
}: {
  alarm: Alarm;
  deckName?: string;
  locale: Locale;
  now: number;
  zone: string;
  use24Hour: boolean;
  onEdit: (alarm: Alarm) => void;
  onToggle: (alarm: Alarm) => void;
  onSkip?: (alarm: Alarm) => void;
  onDuplicate?: (alarm: Alarm) => void;
  onDelete?: () => void;
}) {
  const t = copy(locale);
  const { width, fontScale } = useWindowDimensions();
  const time = clockText(alarm.rule.hour, alarm.rule.minute, use24Hour, locale);
  const offer = skipOffer(alarm, now, zone);
  const ringsAfterSkip =
    skipOffer({ ...alarm, enabled: true }, now, zone) === "undo"
      ? upcomingRing({ ...alarm, enabled: true }, now, zone)
      : null;
  return (
    <View className="rounded-lg bg-surface p-4">
      <View className="flex-row items-center gap-3">
        <AlarmCardMenu
          name={`${time}, ${alarm.label || deckName || t("chooseDeck")}, ${repeatSummary(alarm.rule, { locale, now, zone })}, ${alarm.need === 1 ? t("oneCard") : t("needCount", { count: String(alarm.need) })}`}
          locale={locale}
          items={alarmMenuItems(alarm, { offer, locale, now, zone, onSkip, onDuplicate, onDelete })}
          onPress={() => onEdit(alarm)}
        >
          <Text
            className={alarm.enabled ? "text-foreground" : "text-muted-foreground"}
            style={{
              ...clock,
              fontSize: Math.min(44, (width - 156) / ((use24Hour ? 3.3 : 5.5) * fontScale)),
            }}
          >
            {time}
          </Text>
          {alarm.rule.onceDate ? (
            <Text style={regular} className="text-label text-muted-foreground">
              {new Intl.DateTimeFormat(locale, { timeZone: "UTC", dateStyle: "medium" }).format(
                Date.parse(alarm.rule.onceDate + "T12:00:00Z"),
              )}
              {alarm.quick ? ` · ${t("quick")}` : null}
            </Text>
          ) : (
            <View
              accessible
              accessibilityLabel={repeatSummary(alarm.rule, { locale, now, zone })}
              className="flex-row flex-wrap gap-2"
            >
              {EVERY_DAY.map((day) => (
                <Text
                  key={day}
                  style={alarm.rule.repeatDays?.includes(day) ? bold : regular}
                  className={
                    alarm.rule.repeatDays?.includes(day) && alarm.enabled
                      ? "text-caption text-primary-ink"
                      : "text-caption text-muted-foreground"
                  }
                >
                  {weekdayName(day, locale).slice(0, 1)}
                </Text>
              ))}
            </View>
          )}
          <AlarmCardDetails
            alarm={alarm}
            deckName={deckName}
            locale={locale}
            ringsAfterSkip={ringsAfterSkip}
            zone={zone}
          />
        </AlarmCardMenu>
        <Switch
          accessibilityLabel={`${alarm.label || time}: ${t(alarm.enabled ? "enabled" : "disabled")}`}
          value={alarm.enabled}
          onValueChange={(enabled) => onToggle({ ...alarm, enabled })}
        />
      </View>
    </View>
  );
}

export function HomeScreen({
  alarms,
  decks,
  locale,
  zone,
  use24Hour,
  onEdit,
  onAdd,
  onToggle,
  onSkip,
  onDuplicate,
  banner,
  error,
  refreshing,
  onRefresh,
  onDelete,
  onRestore,
  onQuickAlarm,
  setup,
}: {
  alarms: readonly Alarm[];
  decks: readonly Deck[];
  locale: Locale;
  zone: string;
  use24Hour: boolean;
  onEdit: (alarm: Alarm) => void;
  onAdd: () => void;
  onToggle: (alarm: Alarm) => void;
  /** Saves the alarm with its next ring skipped, or the skip undone. */
  onSkip?: (alarm: Alarm) => void;
  onDuplicate?: (alarm: Alarm) => void;
  banner?: ReactNode;
  error?: string;
  refreshing?: boolean;
  onRefresh?: () => void;
  onDelete?: (id: string) => Promise<void>;
  onRestore?: (alarm: Alarm) => Promise<void>;
  /** Adds a quick alarm that many minutes from now. Without it (no saved alarm or deck), no chips. */
  onQuickAlarm?: (minutes: number, onAdded: (alarm: Alarm) => void) => void;
  /** Given once decks and alarms have loaded; without it Home shows no empty state. */
  setup?: DeckSetup;
}) {
  const now = useNow();
  const { visibleAlarms, removeAlarm, restoreAlarm, undoAvailable, busy, actionError } =
    useAlarmDeletion(alarms, now, onDelete, onRestore);
  const list = useRef<FlatList<Alarm>>(null);
  const needsDeck = setup !== undefined && decks.length === 0;
  const t = copy(locale);
  const next = nextAlarmRing(visibleAlarms, now, zone);
  const { notice, addQuickAlarm } = useQuickAlarmNotice(now, zone, locale, onQuickAlarm);
  return (
    <View className="flex-1 bg-background">
      <FlatList
        ref={list}
        data={visibleAlarms}
        keyExtractor={(alarm) => alarm.id}
        contentContainerStyle={{ padding: 24, gap: 16, paddingBottom: 112 }}
        refreshing={refreshing ?? false}
        onRefresh={onRefresh}
        ListHeaderComponent={
          <View className="gap-4 pb-4">
            <View className="items-center gap-2 py-8">
              <Text
                accessibilityRole="header"
                style={bold}
                className="text-title text-foreground text-center"
              >
                {next
                  ? t("alarmCountdown", { time: durationText(timeLeft(next.remainingMs), locale) })
                  : t("noEnabledAlarms")}
              </Text>
              {next && (
                <Text style={regular} className="text-body text-muted-foreground text-center">
                  {dayText(next.at, locale, zone)} · {timeText(next.at, locale, zone, use24Hour)}
                </Text>
              )}
            </View>
            {onQuickAlarm ? (
              <View className="flex-row flex-wrap gap-2">
                {QUICK_ALARM_MINUTES.map((minutes) => (
                  <Pressable
                    key={minutes}
                    accessibilityRole="button"
                    accessibilityLabel={t("quickAlarmLabel", { count: String(minutes) })}
                    onPress={() => addQuickAlarm(minutes)}
                    className="min-h-12 items-center justify-center rounded-pill bg-surface px-5"
                  >
                    <Text style={bold} className="text-body text-foreground">
                      {t("quickAlarmChip", { count: String(minutes) })}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {notice ? (
              <Text
                accessibilityLiveRegion="polite"
                style={regular}
                className="text-body text-foreground"
              >
                {notice}
              </Text>
            ) : null}
            {banner}
            {error ? (
              <Text style={regular} accessibilityRole="alert" className="text-body text-attention">
                {error}
              </Text>
            ) : null}
            {setup && (needsDeck || !visibleAlarms.length) ? (
              <HomeEmptyState
                locale={locale}
                hasDecks={decks.length > 0}
                setup={setup}
                onAdd={onAdd}
              />
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <SwipeAlarm
            id={item.id}
            onDelete={() => {
              void removeAlarm(item);
            }}
          >
            <AlarmCard
              alarm={item}
              deckName={decks.find((d) => d.id === item.deckId)?.name}
              locale={locale}
              now={now}
              zone={zone}
              use24Hour={use24Hour}
              onEdit={onEdit}
              onToggle={onToggle}
              onSkip={onSkip}
              onDuplicate={onDuplicate}
              onDelete={
                onDelete
                  ? () => {
                      void removeAlarm(item);
                    }
                  : undefined
              }
            />
          </SwipeAlarm>
        )}
      />
      {actionError && (
        <Text style={regular} accessibilityRole="alert" className="text-body text-destructive">
          {t("alarmError")}
        </Text>
      )}
      {undoAvailable && (
        <View className="absolute bottom-24 left-6 right-6 flex-row items-center justify-between gap-2 rounded-lg bg-surface p-4">
          <Text
            accessibilityRole="alert"
            style={regular}
            className="shrink text-body text-foreground"
          >
            {t("alarmDeleted")}
          </Text>
          <Button
            label={t("undoAlarmDelete")}
            disabled={busy}
            onPress={() => {
              void restoreAlarm();
            }}
          />
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("add")}
        // Without a deck, + leads to the empty state at the top instead of the editor.
        onPress={needsDeck ? () => list.current?.scrollToOffset({ offset: 0 }) : onAdd}
        className="absolute bottom-4 right-6 min-h-16 min-w-20 items-center justify-center rounded-pill bg-primary px-6 py-4"
      >
        <Text style={bold} className="text-question text-primary-foreground">
          +
        </Text>
      </Pressable>
    </View>
  );
}
