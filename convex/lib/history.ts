/**
 * History arithmetic (admin statistics): India-time days, weekly / monthly
 * totals and the approximate usage rate. Pure functions, shared with tests.
 */
import { formatInTimeZone } from "date-fns-tz";
import { TIMEZONE } from "./time";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The India date ("YYYY-MM-DD") of a moment. */
export function istDay(ms: number): string {
  return formatInTimeZone(new Date(ms), TIMEZONE, "yyyy-MM-dd");
}

/** The moment an India date starts. */
export function istStart(date: string): number {
  return Date.parse(`${date}T00:00:00+05:30`);
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Shifts a "YYYY-MM-DD" date by `n` days. */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The Monday of the date's week. */
export function weekStart(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -((day + 6) % 7));
}

export const monthOf = (date: string) => date.slice(0, 7);

function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export type Bucket = {
  /** "YYYY-MM-DD" (the week's Monday) or "YYYY-MM". */
  period: string;
  quantity: number;
  totalPaise: number;
  purchases: number;
};

/**
 * Quantity and spend per week (Monday to Sunday) or per calendar month, in
 * India time. Periods with no purchase between `from` and `to` (or the first
 * and last purchase) are included with zeros so charts show the gaps.
 */
export function bucketTotals(
  lines: readonly { loggedAt: number; quantity: number; totalPaise: number }[],
  by: "week" | "month",
  range?: { from: string; to: string },
): Bucket[] {
  const keyOf = (date: string) => (by === "week" ? weekStart(date) : monthOf(date));
  const totals = new Map<string, Bucket>();
  for (const line of lines) {
    const period = keyOf(istDay(line.loggedAt));
    const bucket = totals.get(period) ?? { period, quantity: 0, totalPaise: 0, purchases: 0 };
    bucket.quantity = Math.round((bucket.quantity + line.quantity) * 1_000_000) / 1_000_000;
    bucket.totalPaise += line.totalPaise;
    bucket.purchases += 1;
    totals.set(period, bucket);
  }
  const keys = [...totals.keys()].sort();
  const first = range ? keyOf(range.from) : keys[0];
  const last = range ? keyOf(range.to) : keys[keys.length - 1];
  if (first === undefined || last === undefined) return [];
  const out: Bucket[] = [];
  for (let period = first; period <= last; period = by === "week" ? addDays(period, 7) : nextMonth(period)) {
    out.push(totals.get(period) ?? { period, quantity: 0, totalPaise: 0, purchases: 0 });
    if (out.length > 1000) break;
  }
  return out;
}

/** How many of the latest gaps between purchases the usage rate averages. */
export const USAGE_RECENT_INTERVALS = 5;

export type UsageRate = {
  /** Base units used per day, on average, over the recent gaps. */
  perDay: number;
  /** Days one base unit lasts (1 ÷ perDay): "1 cylinder lasts ≈9 days". */
  daysPerUnit: number;
  /** How many gaps between purchases the average is based on. */
  intervals: number;
  /** The first and last purchase day the average covers. */
  fromDay: string;
  toDay: string;
};

/**
 * Approximate usage from consecutive purchases in ONE scope: what was bought
 * lasted until the next purchase, so each gap's rate is the earlier
 * purchase's quantity ÷ the days until the next one. Purchases on the same
 * day count as one. The result averages the latest gaps (total quantity ÷
 * total days). Null with fewer than two purchase days: not enough data.
 */
export function usageRate(
  purchases: readonly { loggedAt: number; quantity: number }[],
  recent = USAGE_RECENT_INTERVALS,
): UsageRate | null {
  const perDay = new Map<string, number>();
  for (const p of purchases) {
    const day = istDay(p.loggedAt);
    perDay.set(day, (perDay.get(day) ?? 0) + p.quantity);
  }
  const days = [...perDay.keys()].sort();
  if (days.length < 2) return null;
  const gaps: { quantity: number; days: number }[] = [];
  for (let i = 0; i < days.length - 1; i += 1) {
    const gapDays = (istStart(days[i + 1]) - istStart(days[i])) / DAY_MS;
    gaps.push({ quantity: perDay.get(days[i])!, days: gapDays });
  }
  const used = gaps.slice(-recent);
  const quantity = used.reduce((sum, g) => sum + g.quantity, 0);
  const totalDays = used.reduce((sum, g) => sum + g.days, 0);
  if (totalDays <= 0 || quantity <= 0) return null;
  const rate = quantity / totalDays;
  return {
    perDay: rate,
    daysPerUnit: 1 / rate,
    intervals: used.length,
    fromDay: days[days.length - 1 - used.length],
    toDay: days[days.length - 1],
  };
}
