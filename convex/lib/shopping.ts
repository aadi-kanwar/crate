/**
 * Shopping list arithmetic: the expected price of a planned item and the
 * estimated bill per shop. Pure functions, shared with tests.
 */

export type PriceSource = "typed" | "this_shop" | "any_shop";

/**
 * The price per unit to expect: the one typed on the list, else the last
 * price paid at the planned shop (same variant when one is set), else the
 * last price paid anywhere (same variant, then any variant). Null when the
 * item has never been bought and no price was typed.
 *
 * `history` is the item's purchases, newest first.
 */
export function expectedUnitPrice(
  row: { variant?: string; shopId?: string; expectedUnitPricePaise?: number },
  history: readonly { shopId: string; variant?: string; unitPricePaise: number }[],
): { unitPricePaise: number; source: PriceSource } | null {
  if (row.expectedUnitPricePaise !== undefined) return { unitPricePaise: row.expectedUnitPricePaise, source: "typed" };
  const sameVariant = (h: { variant?: string }) => row.variant === undefined || h.variant === row.variant;
  const atShop = row.shopId ? history.find((h) => h.shopId === row.shopId && sameVariant(h)) : undefined;
  if (atShop) return { unitPricePaise: atShop.unitPricePaise, source: "this_shop" };
  const anywhere = history.find(sameVariant) ?? history[0];
  return anywhere ? { unitPricePaise: anywhere.unitPricePaise, source: "any_shop" } : null;
}

export type ShopBill = {
  /** null: no shop chosen yet. */
  shopId: string | null;
  items: number;
  /** Planned quantity × expected price, for the items with a price. */
  estimatedPaise: number;
  /** Items with no price to go on (never bought, none typed). */
  unpriced: number;
  /** Ticked off at this shop so far. */
  boughtItems: number;
  boughtPaise: number;
};

/**
 * The estimated bill per shop (by planned shop) and what has been ticked off
 * per shop (by the shop it was actually bought at), shops in first-seen order.
 */
export function shopBills(
  rows: readonly {
    shopId?: string;
    estimatePaise: number | null;
    bought?: { shopId: string; totalPaise: number };
  }[],
): ShopBill[] {
  const bills = new Map<string | null, ShopBill>();
  const bill = (shopId: string | null) => {
    let b = bills.get(shopId);
    if (!b) {
      b = { shopId, items: 0, estimatedPaise: 0, unpriced: 0, boughtItems: 0, boughtPaise: 0 };
      bills.set(shopId, b);
    }
    return b;
  };
  for (const row of rows) {
    const planned = bill(row.shopId ?? null);
    planned.items += 1;
    if (row.estimatePaise === null) planned.unpriced += 1;
    else planned.estimatedPaise += row.estimatePaise;
    if (row.bought) {
      const actual = bill(row.bought.shopId);
      actual.boughtItems += 1;
      actual.boughtPaise += row.bought.totalPaise;
    }
  }
  return [...bills.values()];
}
