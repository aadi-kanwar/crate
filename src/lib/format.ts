import { formatInTimeZone } from "date-fns-tz";
import { TIMEZONE } from "@convex/lib/time";

export { formatINR, formatPaise } from "@convex/lib/money";

/** "24 Oct 2026, 8:14 PM" in India time. */
export function formatDateTime(ms: number): string {
  return formatInTimeZone(new Date(ms), TIMEZONE, "d MMM yyyy, h:mm a");
}

/** Today's date (YYYY-MM-DD) in India. */
export function todayIn(nowMs = Date.now()): string {
  return formatInTimeZone(new Date(nowMs), TIMEZONE, "yyyy-MM-dd");
}

/** A calendar date (YYYY-MM-DD) as "Sun, 25 Oct" (or another pattern). */
export function formatDay(date: string, pattern = "EEE, d MMM"): string {
  return formatInTimeZone(new Date(`${date}T12:00:00Z`), "UTC", pattern);
}

/** "25 Oct 2026". */
export const formatDate = (date: string) => formatDay(date, "d MMM yyyy");

/** "YYYY-MM" as "November 2026". */
export const formatMonth = (month: string) => formatDay(`${month}-01`, "MMMM yyyy");

/** Shifts a "YYYY-MM" month by `n`. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
