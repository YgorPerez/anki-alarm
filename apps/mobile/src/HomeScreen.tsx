import Plus from "lucide-react-native/icons/plus";
import X from "lucide-react-native/icons/x";
import { ThemedIcon } from "./icons.tsx";
import { useAlarmDeletion } from "./useAlarmDeletion.ts";
import { useQuickAlarmNotice } from "./useQuickAlarmNotice.ts";
import { SwipeAlarm } from "./SwipeAlarm.tsx";
import { Button } from "./controls.tsx";
import { LongPressMenu } from "./LongPressMenu.tsx";
import {
  nextAlarmRing,
  ringAfterSkip,
  skipNextRing,
  skipOffer,
  undoSkip,
  timeLeft,
  QUICK_ALARM_MINUTES,
  type Alarm,
  type Locale,
} from "@app/core";
import { useRef, type ReactNode } from "react";
import { FlatList, Pressable, Switch, Text, View, useWindowDimensions } from "react-native";
import { ClockFigures, useNow } from "./clock.tsx";
import {
  clockParts,
  clockText,
  countdownText,
  needText,
  onceDateText,
  repeatSummary,
  timeText,
  WEEK_FROM_SUNDAY,
  weekdayLetter,
} from "./alarm-text.ts";
import { bold, CLOCK_EMS, clock, fittedClockSize, regular } from "./fonts.ts";
import { copy } from "./copy.ts";
import { HomeEmptyState, type DeckSetup } from "./HomeEmptyState.tsx";

type Deck = { id: string; name: string };

// The page and card padding, the gap and the switch beside a card's time.
const CARD_CHROME_WIDTH = 156;

function dayText(at: number, locale: Locale, zone: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(at);
}

/** The card menu: skip or undo the next ring when that's on offer, duplicate and delete. */
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
  title,
  need,
  skipped,
}: {
  title: string;
  need: string;
  skipped: string | null;
}) {
  return (
    <>
      {skipped !== null && (
        <Text style={regular} className="text-label text-attention">
          {skipped}
        </Text>
      )}
      <Text style={regular} numberOfLines={1} className="text-label text-muted-foreground">
        {title} · {need}
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
  const ringsAfterSkip = ringAfterSkip(alarm, now, zone);
  const skipped =
    ringsAfterSkip === null
      ? null
      : t("skippedUntil", { date: dayText(ringsAfterSkip, locale, zone) });
  const title = alarm.label || deckName || t("chooseDeck");
  const need = needText(alarm.need, locale);
  const accessibilityLabel = [
    time,
    title,
    repeatSummary(alarm.rule, { locale, now, zone }),
    skipped,
    need,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <View className="rounded-lg bg-surface p-4">
      <View className="flex-row items-center gap-3">
        <LongPressMenu
          accessibilityLabel={accessibilityLabel}
          actionLabel={t("moreOptions")}
          actionHint={t("moreOptionsHint")}
          className="min-h-12 min-w-0 flex-1 gap-1"
          items={alarmMenuItems(alarm, { offer, locale, now, zone, onSkip, onDuplicate, onDelete })}
          onPress={() => onEdit(alarm)}
        >
          <ClockFigures
            parts={clockParts(alarm.rule.hour, alarm.rule.minute, use24Hour, locale)}
            className={alarm.enabled ? "text-foreground" : "text-muted-foreground"}
            fontSize={fittedClockSize(width - CARD_CHROME_WIDTH, CLOCK_EMS.card, fontScale, 44)}
          />
          {alarm.rule.onceDate ? (
            <Text style={regular} className="text-label text-muted-foreground">
              {onceDateText(alarm.rule.onceDate, locale)}
              {alarm.quick ? ` · ${t("quick")}` : null}
            </Text>
          ) : (
            <View className="flex-row flex-wrap gap-2">
              {WEEK_FROM_SUNDAY.map((day) => (
                <Text
                  key={day}
                  style={alarm.rule.repeatDays?.includes(day) ? bold : regular}
                  className={
                    alarm.rule.repeatDays?.includes(day) && alarm.enabled
                      ? "text-caption text-foreground"
                      : "text-caption text-muted-foreground"
                  }
                >
                  {weekdayLetter(day, locale)}
                </Text>
              ))}
            </View>
          )}
          <AlarmCardDetails title={title} need={need} skipped={skipped} />
        </LongPressMenu>
        <Switch
          accessibilityLabel={`${alarm.label || time}: ${t(alarm.enabled ? "enabled" : "disabled")}`}
          value={alarm.enabled}
          onValueChange={(enabled) => onToggle({ ...alarm, enabled })}
        />
      </View>
    </View>
  );
}

function HomeHeader({
  next,
  locale,
  zone,
  use24Hour,
  banner,
  error,
  setup,
  showEmptyState,
  hasDecks,
  onAdd,
}: {
  next: ReturnType<typeof nextAlarmRing>;
  locale: Locale;
  zone: string;
  use24Hour: boolean;
  banner?: ReactNode;
  error?: string;
  setup?: DeckSetup;
  showEmptyState: boolean;
  hasDecks: boolean;
  onAdd: () => void;
}) {
  const t = copy(locale);
  return (
    <View className="gap-4 pb-4">
      <View className="items-center gap-2 py-8">
        <Text
          accessibilityRole="header"
          style={bold}
          className="text-title text-foreground text-center"
        >
          {next
            ? t("alarmCountdown", { time: countdownText(timeLeft(next.remainingMs), locale) })
            : t("noEnabledAlarms")}
        </Text>
        {next && (
          <Text style={regular} className="text-body text-muted-foreground text-center">
            {dayText(next.at, locale, zone)} ·{" "}
            <Text style={clock}>{timeText(next.at, locale, zone, use24Hour)}</Text>
          </Text>
        )}
      </View>
      {banner}
      {error ? (
        <Text style={regular} accessibilityRole="alert" className="text-body text-attention">
          {error}
        </Text>
      ) : null}
      {setup && showEmptyState ? (
        <HomeEmptyState locale={locale} hasDecks={hasDecks} setup={setup} onAdd={onAdd} />
      ) : null}
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
  quickHint,
  onQuickHintSeen,
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
  /** Adds a quick alarm that many minutes from now. Without it (no saved alarm or deck), + only adds. */
  onQuickAlarm?: (minutes: number, onAdded: (alarm: Alarm) => void) => void;
  /** Asks for the one-time hint about long-pressing +. It shows only with onQuickAlarm. */
  quickHint?: boolean;
  /** The hint was dismissed, or the quick alarms were opened. */
  onQuickHintSeen?: () => void;
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
          <HomeHeader
            next={next}
            locale={locale}
            zone={zone}
            use24Hour={use24Hour}
            banner={banner}
            error={error}
            setup={setup}
            showEmptyState={needsDeck || !visibleAlarms.length}
            hasDecks={decks.length > 0}
            onAdd={onAdd}
          />
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
      <View pointerEvents="box-none" className="absolute bottom-24 left-6 right-6 gap-2">
        {quickHint && onQuickAlarm ? (
          <View className="max-w-72 flex-row items-start gap-2 self-end rounded-lg bg-primary-tint py-2 pl-4 pr-2">
            <Text
              accessibilityLiveRegion="polite"
              style={regular}
              className="shrink py-2 text-label text-foreground"
            >
              {t("quickHint")}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("quickHintDismiss")}
              onPress={onQuickHintSeen}
              className="min-h-12 min-w-12 items-center justify-center rounded-pill"
            >
              <ThemedIcon icon={X} />
            </Pressable>
          </View>
        ) : null}
        {notice ? (
          <Text
            accessibilityLiveRegion="polite"
            style={regular}
            className="rounded-lg bg-surface p-4 text-body text-foreground"
          >
            {notice}
          </Text>
        ) : null}
        {undoAvailable && (
          <View className="flex-row items-center justify-between gap-2 rounded-lg bg-surface p-4">
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
      </View>
      <LongPressMenu
        accessibilityLabel={t("add")}
        actionLabel={t("quickAlarms")}
        actionHint={t("quickAlarmsHint")}
        onOpen={onQuickHintSeen}
        items={
          onQuickAlarm
            ? QUICK_ALARM_MINUTES.map((minutes) => ({
                label: t("quickAlarmChip", { count: String(minutes) }),
                accessibilityLabel: t("quickAlarmLabel", { count: String(minutes) }),
                onPress: () => addQuickAlarm(minutes),
              }))
            : []
        }
        // Without a deck, + leads to the empty state at the top instead of the editor.
        onPress={needsDeck ? () => list.current?.scrollToOffset({ offset: 0 }) : onAdd}
        className="absolute bottom-4 right-6 min-h-16 min-w-20 items-center justify-center rounded-pill bg-primary px-6 py-4"
      >
        <ThemedIcon icon={Plus} colorClassName="text-primary-foreground" size={32} />
      </LongPressMenu>
    </View>
  );
}
