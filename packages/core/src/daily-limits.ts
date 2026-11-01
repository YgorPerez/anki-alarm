import type { Deck, Preset } from "./collection.ts";

export type LimitKind = "new" | "review";
export const LIMIT_SCOPES = ["preset", "deck", "today"] as const;
export type LimitScope = (typeof LIMIT_SCOPES)[number];

const presetLimit = (preset: Preset, kind: LimitKind) =>
  preset.fields[kind === "new" ? "newPerDay" : "reviewsPerDay"].value;
/** A today override counts only on the study day it was set. */
const todayLimit = (deck: Deck, kind: LimitKind, dayStart: number) => {
  const today = deck.fields[`${kind}LimitToday`]?.value;
  return today?.day === dayStart ? today.limit : undefined;
};

/** The scope a deck's limit comes from on the study day starting at `dayStart`. */
function limitScope(deck: Deck, kind: LimitKind, dayStart: number): LimitScope {
  if (todayLimit(deck, kind, dayStart) !== undefined) return "today";
  return deck.fields[`${kind}Limit`]?.value == null ? "preset" : "deck";
}

/** The number a scope holds; a scope with nothing set shows what the deck follows now. */
export function scopedLimit(
  deck: Deck,
  preset: Preset,
  kind: LimitKind,
  scope: LimitScope,
  dayStart: number,
): number {
  if (scope === "preset") return presetLimit(preset, kind);
  const own = deck.fields[`${kind}Limit`]?.value ?? presetLimit(preset, kind);
  return scope === "deck" ? own : (todayLimit(deck, kind, dayStart) ?? own);
}

/** The limit in force: today's, then this deck's, then the preset's. */
export function dailyLimit(deck: Deck, preset: Preset, kind: LimitKind, dayStart: number) {
  return scopedLimit(deck, preset, kind, limitScope(deck, kind, dayStart), dayStart);
}

/**
 * The form values for a deck's two limits, which replace the preset's numbers in deck options.
 * Without a deck, the preset's own.
 */
export function deckLimitTexts(deck: Deck | undefined, preset: Preset, dayStart: number) {
  const scope = (kind: LimitKind): LimitScope =>
    deck ? limitScope(deck, kind, dayStart) : "preset";
  const limit = (kind: LimitKind) =>
    String(deck ? dailyLimit(deck, preset, kind, dayStart) : presetLimit(preset, kind));
  return {
    newPerDay: limit("new"),
    newScope: scope("new"),
    reviewsPerDay: limit("review"),
    reviewScope: scope("review"),
  };
}
