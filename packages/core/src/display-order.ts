/** How a review mixes with another kind of card. Each value's number is Anki's. */
const MIX = { mix: 0, after: 1, before: 2 } as const;

/**
 * Anki's five display order options: each choice in the order Anki lists it, with the number Anki
 * stores for it. Part of the `.apkg` format: never renumber. Zero is Anki's default for all five.
 * The app is FSRS-only, so Anki's ease orders are the difficulty orders it shows under FSRS.
 */
export const DISPLAY_ORDER = {
  newGatherPriority: {
    deck: 0,
    deckThenRandomNotes: 5,
    lowestPosition: 1,
    highestPosition: 2,
    randomNotes: 3,
    randomCards: 4,
  },
  newSortOrder: {
    template: 0,
    noSort: 1,
    templateThenRandom: 2,
    randomNoteThenTemplate: 3,
    randomCard: 4,
  },
  newMix: MIX,
  interdayLearningMix: MIX,
  reviewOrder: {
    day: 0,
    dayThenDeck: 1,
    deckThenDay: 2,
    intervalsAscending: 3,
    intervalsDescending: 4,
    difficultyDescending: 5,
    difficultyAscending: 6,
    retrievabilityAscending: 7,
    retrievabilityDescending: 11,
    relativeOverdueness: 12,
    random: 8,
    added: 9,
    reverseAdded: 10,
  },
} as const;
export type DisplayOrder = {
  -readonly [K in keyof typeof DISPLAY_ORDER]: keyof (typeof DISPLAY_ORDER)[K];
};
export const DISPLAY_ORDER_KEYS = [
  "newGatherPriority",
  "newSortOrder",
  "newMix",
  "interdayLearningMix",
  "reviewOrder",
] as const satisfies readonly (keyof DisplayOrder)[];
export const DEFAULT_DISPLAY_ORDER: DisplayOrder = {
  newGatherPriority: "deck",
  newSortOrder: "template",
  newMix: "mix",
  interdayLearningMix: "mix",
  reviewOrder: "day",
};

export const validDisplayOrder = <K extends keyof DisplayOrder>(
  key: K,
  value: unknown,
): value is DisplayOrder[K] => Object.keys(DISPLAY_ORDER[key]).includes(String(value));

/** Anki's stored numbers, by Anki's schema-11 key. Missing or unknown: Anki's default. */
export function displayOrderFromAnki(stored: {
  [K in keyof DisplayOrder]?: unknown;
}): DisplayOrder {
  const read = <K extends keyof DisplayOrder>(key: K): DisplayOrder[K] => {
    const number = stored[key] ?? 0;
    const choice = Object.entries(DISPLAY_ORDER[key]).find(([, n]) => n === number)?.[0];
    return validDisplayOrder(key, choice) ? choice : DEFAULT_DISPLAY_ORDER[key];
  };
  return {
    newGatherPriority: read("newGatherPriority"),
    newSortOrder: read("newSortOrder"),
    newMix: read("newMix"),
    interdayLearningMix: read("interdayLearningMix"),
    reviewOrder: read("reviewOrder"),
  };
}

/** The numbers Anki stores, under its schema-11 keys. */
export function displayOrderToAnki(order: DisplayOrder) {
  return {
    newGatherPriority: DISPLAY_ORDER.newGatherPriority[order.newGatherPriority],
    newSortOrder: DISPLAY_ORDER.newSortOrder[order.newSortOrder],
    newMix: DISPLAY_ORDER.newMix[order.newMix],
    interdayLearningMix: DISPLAY_ORDER.interdayLearningMix[order.interdayLearningMix],
    reviewOrder: DISPLAY_ORDER.reviewOrder[order.reviewOrder],
  };
}
