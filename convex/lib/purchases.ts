/**
 * Purchase arithmetic, shared by the backend (which always recomputes) and
 * the entry screen (which shows the same numbers live). No database access.
 *
 * Money is integer paise; quantities are in the item's base unit.
 */

/** Managers and kitchen staff may edit or delete an entry for this long after it was logged. */
export const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** How many earlier purchases the price check looks at. */
export const PRICE_CHECK_HISTORY = 5;
/** A unit price above this multiple of the recent median (or below its inverse) is questioned. */
export const PRICE_CHECK_FACTOR = 2;

export const MAX_LINES = 60;
export const MAX_QUANTITY = 100_000;
export const MAX_LINE_PAISE = 100_000_000; // ₹10,00,000 for one line

export type PackSize = { label: string; quantity: number };

/** Rounds away floating-point noise (0.1 + 0.2 → 0.3); 6 decimals is plenty for kg/litres. */
export function tidyQuantity(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * The quantity in base units: either given directly, or `packCount` packs of
 * the named pack size (e.g. 4 × "500 ml packet" of 0.5 L = 2 L). Returns null
 * when it doesn't add up to a usable quantity.
 */
export function lineQuantity(
  input: { quantity?: number; packLabel?: string; packCount?: number },
  packSizes: readonly PackSize[],
): { quantity: number; packLabel?: string; packCount?: number } | null {
  if (input.packLabel !== undefined) {
    const pack = packSizes.find((p) => p.label === input.packLabel);
    const count = input.packCount;
    if (!pack || count === undefined || !Number.isFinite(count) || count <= 0)
      return null;
    const quantity = tidyQuantity(count * pack.quantity);
    if (quantity <= 0 || quantity > MAX_QUANTITY) return null;
    return { quantity, packLabel: pack.label, packCount: count };
  }
  const quantity = input.quantity;
  if (quantity === undefined || !Number.isFinite(quantity)) return null;
  const tidy = tidyQuantity(quantity);
  if (tidy <= 0 || tidy > MAX_QUANTITY) return null;
  return { quantity: tidy };
}

/** ₹ per base unit, in whole paise: total ÷ quantity. */
export function unitPricePaise(totalPaise: number, quantity: number): number {
  if (!(quantity > 0)) throw new Error("quantity must be positive");
  return Math.round(totalPaise / quantity);
}

/** Rupees typed by a person ("1,250.5") to integer paise, or null. */
export function rupeesToPaise(text: string): number | null {
  const cleaned = text.replace(/[,\s₹]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const paise = Math.round(Number(cleaned) * 100);
  return Number.isSafeInteger(paise) ? paise : null;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export type PriceCheck =
  | { status: "ok" }
  | { status: "high" | "low"; medianPaise: number };

/**
 * "Did you mean…?": compares a unit price with the median of the last
 * purchases (newest first; only the first PRICE_CHECK_HISTORY count). More
 * than twice the median, or less than half of it, is questioned. With no
 * history there is nothing to compare, so it's fine.
 */
export function checkPrice(
  unitPrice: number,
  recentUnitPrices: readonly number[],
): PriceCheck {
  const m = median(recentUnitPrices.slice(0, PRICE_CHECK_HISTORY));
  if (m === null || m <= 0) return { status: "ok" };
  if (unitPrice > m * PRICE_CHECK_FACTOR)
    return { status: "high", medianPaise: Math.round(m) };
  if (unitPrice < m / PRICE_CHECK_FACTOR)
    return { status: "low", medianPaise: Math.round(m) };
  return { status: "ok" };
}

/** Whether a manager / kitchen staff member may still change an entry logged at `loggedAt`. */
export function withinEditWindow(loggedAt: number, now: number): boolean {
  return now - loggedAt <= EDIT_WINDOW_MS;
}

/** Lower-case, single-spaced text for matching names and aliases. */
export function searchKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** True when every word typed appears at the start of a word of the name or an alias. */
export function matchesSearch(
  query: string,
  name: string,
  aliases: readonly string[] = [],
): boolean {
  const words = searchKey(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  return [name, ...aliases].some((text) => {
    const key = searchKey(text);
    const parts = key.split(/[\s\-/(),.]+/);
    return words.every(
      (w) => parts.some((p) => p.startsWith(w)) || key.includes(w),
    );
  });
}
