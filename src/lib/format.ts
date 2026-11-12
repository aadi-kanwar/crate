import { formatInTimeZone } from "date-fns-tz";
import { TIMEZONE } from "@convex/lib/time";
import type { BaseUnit } from "@convex/lib/validators";
import { UNIT_LABEL } from "./labels";

import { formatPaise } from "@convex/lib/money";

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


const qtyFormat = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });

/** "2.5 kg", "1 cylinder", "3 pieces". */
export function formatQuantity(quantity: number, unit: BaseUnit): string {
  const label = quantity === 1 ? UNIT_LABEL[unit].one : UNIT_LABEL[unit].many;
  return `${qtyFormat.format(quantity)} ${label}`;
}

/** "₹40/kg", "₹1,100/cylinder". */
export function formatUnitPrice(paise: number, unit: BaseUnit): string {
  return `${formatPaise(paise)}/${UNIT_LABEL[unit].one}`;
}

/** A number typed on a phone keypad ("2.5", "2,5"), or null. */
export function parseDecimal(text: string): number | null {
  const cleaned = text.trim().replace(",", ".");
  if (!/^\d*\.?\d+$|^\d+\.$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** "Today, 8:14 PM", "Yesterday, 9:02 AM", or "Mon, 3 Nov, 9:02 AM" in India time. */
export function formatWhen(ms: number, nowMs = Date.now()): string {
  const day = formatInTimeZone(new Date(ms), TIMEZONE, "yyyy-MM-dd");
  const time = formatInTimeZone(new Date(ms), TIMEZONE, "h:mm a");
  const today = todayIn(nowMs);
  const yesterday = todayIn(nowMs - 86_400_000);
  if (day === today) return `Today, ${time}`;
  if (day === yesterday) return `Yesterday, ${time}`;
  return `${formatInTimeZone(new Date(ms), TIMEZONE, day.slice(0, 4) === today.slice(0, 4) ? "EEE, d MMM" : "d MMM yyyy")}, ${time}`;
}

/** "3 Nov" (this year) or "3 Nov 2025", India time. */
export function formatShortDate(ms: number, nowMs = Date.now()): string {
  const sameYear = formatInTimeZone(new Date(ms), TIMEZONE, "yyyy") === formatInTimeZone(new Date(nowMs), TIMEZONE, "yyyy");
  return formatInTimeZone(new Date(ms), TIMEZONE, sameYear ? "d MMM" : "d MMM yyyy");
}
