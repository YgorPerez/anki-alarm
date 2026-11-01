import type { CollectionState, Note, NoteType, Preset } from "./collection.ts";
import { plain, renderSide } from "./template.ts";

/** The language a deck reads aloud in when neither it nor a parent deck has one. */
export const DEFAULT_READ_ALOUD_LANGUAGE = "pt-BR";

/** The languages the alarm editor offers, as BCP 47 tags with their own names. */
export const READ_ALOUD_LANGUAGES = [
  { tag: "pt-BR", name: "Português (Brasil)" },
  { tag: "en-US", name: "English (US)" },
  { tag: "es-ES", name: "Español" },
  { tag: "fr-FR", name: "Français" },
  { tag: "de-DE", name: "Deutsch" },
  { tag: "it-IT", name: "Italiano" },
  { tag: "ja-JP", name: "日本語" },
] as const;

/**
 * The language a deck's cards are read in: its own, else its nearest parent's (Anki names
 * subdecks `Parent::Child`), else pt-BR.
 */
export function deckLanguage(collection: CollectionState, deckId: string) {
  const byName = new Map(collection.decks.map((d) => [d.fields.name.value, d]));
  const path = collection.decks.find((d) => d.id === deckId)?.fields.name.value.split("::") ?? [];
  for (let depth = path.length; depth > 0; depth--) {
    const language = byName.get(path.slice(0, depth).join("::"))?.fields.language?.value;
    if (language) return language;
  }
  return DEFAULT_READ_ALOUD_LANGUAGE;
}

export interface ReadAloudInput {
  note: Note;
  type: NoteType;
  ordinal: number;
  deckName?: string;
  /** The deck's language, as `alarmSession` gives it. */
  language: string;
}
/** What reading a card's front means: its own audio, by media file name, else the text. */
export interface ReadAloud {
  clips: string[];
  text: string;
  language: string;
}

/**
 * Reads a card's front: the `[sound:…]` files in it, in order, and the text a TTS engine falls back
 * to when there are none or none play. Hints and styles aren't read. Null when there's nothing.
 */
export function readAloudFor({ language, ...card }: ReadAloudInput): ReadAloud | null {
  const html = renderSide(card, "front");
  const clips = [...html.matchAll(/\[sound:([^\]]+)\]/g)].map((match) => plain(match[1]!));
  const text = plain(
    html
      .replace(/\[sound:[^\]]*\]/g, " ")
      .replace(/<(style|script|details)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(?:br|\/?div|\/?p|\/?li|\/?tr|\/?h\d)\b[^>]*>/gi, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
  return clips.length || text ? { clips, text, language } : null;
}

const clips = (html: string) => [...html.matchAll(/\[sound:([^\]]+)\]/g)].map((m) => plain(m[1]!));

/** Audio played on a study side; an explicit replay may include the question. */
export function studyAudio(
  input: Omit<ReadAloudInput, "language">,
  side: "front" | "back",
  preset: Preset,
  replay: boolean,
): string[] {
  if (!replay && preset.fields.dontPlayAutomatically.value) return [];
  const answer = clips(renderSide({ ...input, excludeQuestionAudio: true }, side));
  return side === "back" && replay && !preset.fields.skipQuestionWhenReplayingAnswer.value
    ? [...clips(renderSide(input, "front")), ...answer]
    : answer;
}
