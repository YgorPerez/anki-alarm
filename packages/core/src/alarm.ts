/** ISO weekdays: Monday = 1, Sunday = 7. A once-date is a local YYYY-MM-DD. */
export interface AlarmRule {
  hour: number;
  minute: number;
  repeatDays?: readonly number[];
  onceDate?: string;
}

export interface Alarm {
  id: string;
  label: string;
  enabled: boolean;
  rule: AlarmRule;
  vibrate: boolean;
  rampSeconds: number;
  sound: string | null;
}

export const RING_POLICY = { leaveSeconds: 10, idleSeconds: 20, awakeCheckSeconds: 60 };

/** Matches java.time: gaps move forward by the gap; overlaps use the earlier offset. */
export function nextRing(rule: AlarmRule, now: number, zone: string): number | null {
  if (
    !Number.isInteger(rule.hour) ||
    rule.hour < 0 ||
    rule.hour > 23 ||
    !Number.isInteger(rule.minute) ||
    rule.minute < 0 ||
    rule.minute > 59
  ) {
    throw new RangeError("Invalid alarm time");
  }
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const civil = (at: number) => {
    const p = Object.fromEntries(
      formatter.formatToParts(at).map((part) => [part.type, part.value]),
    );
    return Date.UTC(
      Number(p["year"]),
      Number(p["month"]) - 1,
      Number(p["day"]),
      Number(p["hour"]),
      Number(p["minute"]),
      Number(p["second"]),
    );
  };
  const localNow = new Date(civil(now));
  const start = rule.onceDate
    ? Date.parse(`${rule.onceDate}T00:00:00Z`)
    : Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate());
  for (let day = 0; day < (rule.onceDate ? 1 : 8); day++) {
    const date = new Date(start + day * 86400000);
    if (!rule.onceDate && !rule.repeatDays?.includes(date.getUTCDay() || 7)) continue;
    const wall = date.getTime() + (rule.hour * 60 + rule.minute) * 60000;
    const offsets = new Set(
      [-86400000, 0, 86400000].map((delta) => civil(wall + delta) - (wall + delta)),
    );
    const candidates = [...offsets].map((offset) => wall - offset);
    const matches = candidates.filter((candidate) => civil(candidate) === wall);
    const at = matches.length ? Math.min(...matches) : Math.max(...candidates);
    if (at !== undefined && at > now) return at;
  }
  return null;
}
