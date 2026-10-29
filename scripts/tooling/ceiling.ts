export type Counts = Record<string, number>;

/** Missing files have a zero allowance. A saved allowance may only decrease. */
export function checkCeiling(baseline: Counts, actual: Counts, previous: Counts): string[] {
  const errors: string[] = [];
  for (const [file, limit] of Object.entries(baseline)) {
    if (!Number.isSafeInteger(limit) || limit < 0) errors.push(`${file}: invalid ceiling`);
    if (limit > (previous[file] ?? 0))
      errors.push(`${file}: ceiling ${limit} exceeds previous ${previous[file] ?? 0}`);
  }
  for (const [file, count] of Object.entries(actual)) {
    const limit = baseline[file] ?? 0;
    if (count > limit) errors.push(`${file}: ${count} violations exceed ${limit}`);
  }
  return errors;
}
