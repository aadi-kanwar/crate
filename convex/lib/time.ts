import { formatInTimeZone } from "date-fns-tz";

/** All dates in the app are in India Standard Time. */
export const TIMEZONE = "Asia/Kolkata";

/** Today's date (YYYY-MM-DD) in Asia/Kolkata. */
export function todayInIndia(nowMs = Date.now()): string {
  return formatInTimeZone(new Date(nowMs), TIMEZONE, "yyyy-MM-dd");
}

/** "YYYY-MM" of a date. */
export const monthOf = (date: string) => date.slice(0, 7);
