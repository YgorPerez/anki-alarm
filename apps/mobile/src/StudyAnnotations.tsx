import { translator, type Card, type Note, type Locale, type Collection } from "@app/core";
import Svg, { Path } from "react-native-svg";
import { View } from "react-native";
import { StudyMenu } from "./StudyMenu.tsx";

const messages = {
  "pt-BR": {
    flag: "Bandeira",
    clear: "Remover bandeira",
    mark: "Marcar nota",
    unmark: "Desmarcar nota",
    marked: "Nota marcada",
    red: "Vermelha",
    orange: "Laranja",
    green: "Verde",
    blue: "Azul",
    pink: "Rosa",
    turquoise: "Turquesa",
    purple: "Roxa",
  },
  en: {
    flag: "Flag",
    clear: "Clear flag",
    mark: "Mark note",
    unmark: "Unmark note",
    marked: "Marked note",
    red: "Red",
    orange: "Orange",
    green: "Green",
    blue: "Blue",
    pink: "Pink",
    turquoise: "Turquoise",
    purple: "Purple",
  },
};
const flags = [
  { id: 1, name: "red", color: "#d32f2f" },
  { id: 2, name: "orange", color: "#ed6c02" },
  { id: 3, name: "green", color: "#2e9d46" },
  { id: 4, name: "blue", color: "#4285f4" },
  { id: 5, name: "pink", color: "#e86aa6" },
  { id: 6, name: "turquoise", color: "#22b8b0" },
  { id: 7, name: "purple", color: "#a66be0" },
] as const;

/** The owning screen guards and persists each command, then refreshes its current card. */
export function StudyAnnotations({
  next,
  locale,
  busy,
  change,
}: {
  next: { card: Card; note: Note } | undefined;
  locale: Locale;
  busy: boolean;
  change: (command: (c: Collection) => void) => Promise<void>;
}) {
  if (!next) return null;
  const { card, note } = next;
  const t = translator(messages, locale);
  const marked = note.fields.tags.value.includes("marked");
  const flag = flags.find((f) => f.id === card.fields.flag.value);
  const label = (f: (typeof flags)[number]) => `${t("flag")} ${f.id}: ${t(f.name)}`;
  const items = [
    ...flags.map((f) => ({
      id: `flag-${f.id}`,
      label: label(f),
      onPress: () => {
        void change((c) => {
          c.setCardFlag(card.id, f.id);
        });
      },
    })),
    {
      id: "flag-clear",
      label: t("clear"),
      disabled: !flag,
      onPress: () => {
        void change((c) => {
          c.setCardFlag(card.id, 0);
        });
      },
    },
    {
      id: "mark",
      label: t(marked ? "unmark" : "mark"),
      onPress: () => {
        void change((c) => {
          c.setNoteMarked(note.id, !marked);
        });
      },
    },
  ];
  return (
    <View className="flex-row items-center gap-2">
      {flag && (
        <Svg accessible accessibilityLabel={label(flag)} width={20} height={20} viewBox="0 0 24 24">
          <Path
            d="M4 22V3Q9 0 14 3T23 3V15Q18 18 13 15T4 15"
            stroke={flag.color}
            fill={flag.color}
            strokeWidth={2}
          />
        </Svg>
      )}
      {marked && (
        <Svg accessible accessibilityLabel={t("marked")} width={20} height={20} viewBox="0 0 24 24">
          <Path d="m12 2 3 6 7 1-5 5 1 8-6-4-6 4 1-8-5-5 7-1Z" fill="#e0b000" />
        </Svg>
      )}
      <StudyMenu items={items} locale={locale} busy={busy} />
    </View>
  );
}
