/* oxlint-disable unicorn/no-array-sort -- ES2022/Hermes target; only fresh arrays are sorted. */
import type { CollectionState } from "./collection.ts";
import { unescapeHtml } from "./media.ts";
import { isBuried } from "./study.ts";

/** A card as the browser lists it. */
export interface BrowseRow {
  cardId: string;
  noteId: string;
  /** The note's first field, as text. */
  question: string;
  /** Its other fields, as text. */
  answer: string;
  deck: string;
  deckId: string;
  noteType: string;
  /** The template's name, or "Cloze N". */
  card: string;
  suspended: boolean;
  /** Buried until the next study day starts. */
  buried: boolean;
}

/**
 * Lower case, no accents, single spaces: what search compares. Accents are the combining marks
 * NFD splits off, as a plain range: Hermes parses Core on the phone too.
 */
const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
const text = (html: string) => unescapeHtml(html).replace(/\s+/g, " ").trim();

/** Words, `"quoted phrases"`, each optionally negated with `-`. */
function terms(query: string) {
  const found: { negated: boolean; term: string }[] = [];
  for (const match of query.matchAll(/(-?)(?:"([^"]*)"?|(\S+))/g)) {
    const term = fold(match[2] ?? match[3] ?? "");
    if (term) found.push({ negated: match[1] === "-", term });
  }
  return found;
}
/** A name filter: the whole name, `*` for any text, or a parent of it with `::`. */
function names(pattern: string, children: boolean) {
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  const regex = new RegExp(`^${source}${children ? "(::.*)?" : ""}$`, "s");
  return (name: string) => regex.test(fold(name));
}

/**
 * Every card matching an Anki-style search, by its note's first field. Words and quoted phrases
 * match the note's text (case, accents and HTML ignored); `deck:`, `note:`, `card:` (name or
 * number), `tag:`, `is:suspended` and `is:buried` (at `now`) filter, `*` is any text, and `-`
 * negates any term.
 */
export function browseCards(state: CollectionState, query: string, now: number): BrowseRow[] {
  const decks = new Map(state.decks.map((d) => [d.id, d.fields.name.value]));
  const types = new Map(state.noteTypes.map((t) => [t.id, t]));
  const notes = new Map(state.notes.map((n) => [n.id, n]));
  const checks = terms(query).map(({ negated, term }) => {
    const [, prefix, rest = ""] = /^(deck|note|card|tag|is):(.*)$/.exec(term) ?? [];
    const test = (row: BrowseRow, haystack: string, tags: string[], ordinal: number): boolean => {
      if (prefix === "deck") return names(rest, true)(row.deck);
      if (prefix === "note") return names(rest, false)(row.noteType);
      if (prefix === "card") return rest === String(ordinal + 1) || names(rest, false)(row.card);
      if (prefix === "tag") return tags.some(names(rest, true));
      if (prefix === "is")
        return (rest === "suspended" && row.suspended) || (rest === "buried" && row.buried);
      return haystack.includes(term);
    };
    return { negated, test };
  });
  const rows: { row: BrowseRow; ordinal: number }[] = [];
  for (const card of state.cards) {
    const note = notes.get(card.fields.noteId.value);
    const type = note && types.get(note.fields.noteTypeId.value);
    if (!note || !type) continue;
    const ordinal = card.fields.ordinal.value;
    const cloze = type.fields.kind.value === "cloze";
    const values = note.values.map((v) => text(v.value));
    const row = {
      cardId: card.id,
      noteId: note.id,
      question: values[0] ?? "",
      answer: values.slice(1).filter(Boolean).join(" · "),
      deck: decks.get(card.fields.deckId.value) ?? "",
      deckId: card.fields.deckId.value,
      noteType: type.fields.name.value,
      card: cloze
        ? `Cloze ${ordinal + 1}`
        : (type.fields.templates.value[ordinal]?.name ?? `${ordinal + 1}`),
      suspended: card.fields.suspended.value,
      buried: isBuried(card, now),
    };
    const haystack = fold(values.join(" "));
    const tags = note.fields.tags.value;
    if (checks.every(({ negated, test }) => test(row, haystack, tags, ordinal) !== negated))
      rows.push({ row, ordinal });
  }
  const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
  return rows
    .sort(
      (a, b) =>
        collator.compare(a.row.question, b.row.question) ||
        a.row.noteId.localeCompare(b.row.noteId) ||
        a.ordinal - b.ordinal,
    )
    .map(({ row }) => row);
}
