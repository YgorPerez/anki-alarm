/** How much of a normal day's reviews a weekday takes. */
export type EasyDay = "minimum" | "reduced" | "normal";
/** Each weekday's setting, Monday first, as Anki keeps them. */
export const NORMAL_WEEK: readonly EasyDay[] = Array.from({ length: 7 }, () => "normal");
export const EASY_DAYS: readonly EasyDay[] = ["minimum", "reduced", "normal"];
/** What an answer spreads by: the week, and which of its days (0: Monday) the answer's study day was. */
export type EasyDays = { days: EasyDay[]; weekday: number };

const ANKI_PERCENTAGE = { minimum: 0, reduced: 0.5, normal: 1 } as const;
/** Anki's `easyDaysPercentages`: 1 is normal, 0 minimum, anything else reduced, none all normal. */
export const easyDaysFromAnki = (percentages: readonly number[]): EasyDay[] =>
  percentages.length === 7
    ? percentages.map((p) => (p === 1 ? "normal" : p === 0 ? "minimum" : "reduced"))
    : [...NORMAL_WEEK];
export const easyDaysToAnki = (days: readonly EasyDay[]) => days.map((d) => ANKI_PERCENTAGE[d]);

/** Anki leaves intervals above this alone: so far out, the need to balance is low. */
const LONGEST_MOVED = 90;
/** Anki's fuzz: `[from, to, factor]` adds `factor` of a day per interval day in that range. */
const FUZZ_RANGES = [
  [2.5, 7, 0.15],
  [7, 20, 0.1],
  [20, Infinity, 0.05],
] as const;
const fuzzDelta = (interval: number) =>
  interval < 2.5
    ? 0
    : FUZZ_RANGES.reduce(
        (delta, [from, to, factor]) => delta + factor * Math.max(0, Math.min(interval, to) - from),
        1,
      );
const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
/** Anki's `constrained_fuzz_bounds`: the days an interval may land on. */
function fuzzBounds(interval: number, minimum: number, maximum: number) {
  const low = Math.min(minimum, maximum);
  const middle = clamp(interval, low, maximum);
  const delta = fuzzDelta(middle);
  const lower = clamp(Math.round(middle - delta), low, maximum);
  const upper = clamp(Math.round(middle + delta), low, maximum);
  return { lower, upper: upper === lower && upper > 2 && upper < maximum ? lower + 1 : upper };
}
/** Anki's `minimum_review_fuzz_interval`: an interval that grew must stay grown. */
function reviewMinimum(interval: number, previous: number, maximum: number) {
  if (interval > previous) return previous + 1;
  return previous <= fuzzBounds(interval, 1, maximum).upper ? previous : 0;
}

/**
 * Where an answer with this fuzz-free interval lands. Anki picks a day of the fuzz range at random,
 * weighted by the reviews already due on each. Here each card replays alone and with no fuzz, so
 * the rule is Anki's with every day equally loaded: a normal day beats a reduced one and a reduced
 * one beats a minimum one. The interval itself stays unless a better day is in range; among equals
 * the nearest wins, then the earliest. `floor` keeps the grades in order (Anki: the grade below
 * plus one), and `previous` is the interval of a card already in review.
 */
export function easyDayInterval(
  interval: number,
  { days, weekday }: EasyDays,
  { floor, previous, maximum }: { floor: number; previous?: number; maximum: number },
) {
  const kept = Math.min(Math.max(interval, floor), maximum);
  const minimum = Math.max(
    floor,
    previous === undefined ? 1 : reviewMinimum(interval, previous, maximum),
  );
  if (interval > LONGEST_MOVED || minimum > LONGEST_MOVED) return kept;
  const rank = (n: number) => EASY_DAYS.indexOf(days[(weekday + n) % 7]!);
  const { lower, upper } = fuzzBounds(interval, minimum, maximum);
  let best = kept;
  for (let n = lower; n <= upper; n++) {
    const better = rank(n) - rank(best);
    if (better > 0 || (better === 0 && Math.abs(n - kept) < Math.abs(best - kept))) best = n;
  }
  return best;
}
