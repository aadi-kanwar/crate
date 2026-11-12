/**
 * Shopping lists: one live list per property, and one Shared list.
 *
 * - List mode: add items from the master list with the quantity needed (or
 *   a number of packs) and the shop (pre-filled from the item's default
 *   shop); optionally the expected price per unit.
 * - Buy mode: tick items off with the amount paid, changing the quantity,
 *   variant or shop if that's what was bought. Ticked items form the
 *   "Bought" list.
 * - "Save purchases" turns the Bought list into entries, one per shop, with
 *   the same checks, price check and audit as New entry, then clears the
 *   ticks. The items stay on the list for next time.
 *
 * Who: managers / kitchen staff use the lists of their properties and the
 * Shared list; admins use every list. Checked here, never only on screen.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { insertEntry, resolveScope, vScope, type Scope } from "./entries";
import { categoryLabels, categoryRank } from "./lib/categories";
import { appError } from "./lib/errors";
import { memberMutation, memberQuery, type MemberViewer } from "./lib/functions";
import { lineQuantity, MAX_LINE_PAISE, MAX_LINES, unitPricePaise } from "./lib/purchases";
import { expectedUnitPrice, shopBills } from "./lib/shopping";

type Db = Pick<QueryCtx, "db">;

/** Most items a list can hold (keeps every screen fast). */
export const MAX_LIST_ROWS = 300;
/** How many recent purchases of an item the price estimate looks through. */
const PRICE_HISTORY = 60;

const vQuantityInput = {
  variant: v.optional(v.string()),
  quantity: v.optional(v.number()),
  packLabel: v.optional(v.string()),
  packCount: v.optional(v.number()),
};

/** A list row this person may use, else NOT_FOUND. */
async function loadRow(ctx: Db, member: MemberViewer, rowId: Id<"shoppingListItems">) {
  const row = await ctx.db.get(rowId);
  if (row === null || row.organizationId !== member.organization._id) throw appError("NOT_FOUND");
  if (row.scopeKey !== "shared" && !member.properties.some((p) => p._id === row.scopeKey)) throw appError("NOT_FOUND");
  return row;
}

async function loadItem(ctx: Db, member: MemberViewer, itemId: Id<"items">) {
  const item = await ctx.db.get(itemId);
  if (item === null || item.organizationId !== member.organization._id) throw appError("NOT_FOUND");
  return item;
}

async function checkShop(ctx: Db, member: MemberViewer, shopId: Id<"shops"> | undefined, current?: Id<"shops">) {
  if (shopId === undefined) return undefined;
  const shop = await ctx.db.get(shopId);
  if (shop === null || shop.organizationId !== member.organization._id) throw appError("INVALID_INPUT", "Choose a shop.");
  if (shop.archived && shop._id !== current) throw appError("INVALID_INPUT", `"${shop.name}" is archived.`);
  return shop._id;
}

/** Variant and quantity (direct or packs) for an item, or INVALID_INPUT. */
function checkQuantity(
  item: Doc<"items">,
  input: { variant?: string; quantity?: number; packLabel?: string; packCount?: number },
  keepVariant?: string,
) {
  const variant = input.variant?.trim() || undefined;
  if (variant !== undefined && !item.variants.includes(variant) && variant !== keepVariant)
    throw appError("INVALID_INPUT", `"${variant}" isn't a variant of ${item.name}.`);
  const quantity = lineQuantity(input, item.packSizes);
  if (quantity === null) throw appError("INVALID_INPUT", `Enter a quantity above zero for ${item.name}.`);
  return { variant, ...quantity };
}

function checkExpectedPrice(paise: number | undefined) {
  if (paise === undefined) return undefined;
  if (!Number.isSafeInteger(paise) || paise <= 0 || paise > MAX_LINE_PAISE)
    throw appError("INVALID_INPUT", "Enter an expected price above zero, or leave it empty.");
  return paise;
}

async function rowsOf(ctx: Db, organizationId: Id<"organizations">, scopeKey: string) {
  return await ctx.db
    .query("shoppingListItems")
    .withIndex("by_scope", (q) => q.eq("organizationId", organizationId).eq("scopeKey", scopeKey))
    .collect();
}

/** The item's recent purchases, newest first (for price estimates). */
async function priceHistory(ctx: Db, itemId: Id<"items">) {
  const out: { shopId: string; variant?: string; unitPricePaise: number }[] = [];
  for await (const line of ctx.db
    .query("entryLines")
    .withIndex("by_item_loggedAt", (q) => q.eq("itemId", itemId))
    .order("desc")) {
    if (line.deleted) continue;
    out.push({ shopId: line.shopId, variant: line.variant, unitPricePaise: line.unitPricePaise });
    if (out.length >= PRICE_HISTORY) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** The live list of one property (or Shared), with prices, estimates and bills per shop. */
export const get = memberQuery({
  args: { scope: vScope },
  handler: async (ctx, { scope }) => {
    const { member } = ctx;
    const organizationId = member.organization._id;
    const { scopeKey } = resolveScope(member, scope);
    const categories = await ctx.db
      .query("categories")
      .withIndex("by_org_order", (q) => q.eq("organizationId", organizationId))
      .collect();
    const labels = categoryLabels(categories);
    const ranks = categoryRank(categories);
    const shopNames = new Map<string, string>();
    const shopName = async (id: Id<"shops"> | undefined) => {
      if (id === undefined) return null;
      if (!shopNames.has(id)) shopNames.set(id, (await ctx.db.get(id))?.name ?? "");
      return shopNames.get(id)!;
    };
    const rows = await Promise.all(
      (await rowsOf(ctx, organizationId, scopeKey)).map(async (row) => {
        const item = (await ctx.db.get(row.itemId))!;
        const top = categories.find((c) => c._id === item.categoryId);
        const expected = expectedUnitPrice(
          { variant: row.variant, shopId: row.shopId, expectedUnitPricePaise: row.expectedUnitPricePaise },
          await priceHistory(ctx, row.itemId),
        );
        return {
          rowId: row._id,
          itemId: row.itemId,
          itemName: item.name,
          baseUnit: item.baseUnit,
          packSizes: item.packSizes,
          variants: item.variants,
          itemArchived: item.archived,
          categoryId: item.categoryId,
          categoryLabel: labels.get(item.categoryId) ?? "",
          /** Position of the item's category in the category order (for sorting). */
          categoryRank: ranks.get(item.categoryId) ?? Number.MAX_SAFE_INTEGER,
          topCategoryId: top?.parentId ?? item.categoryId,
          variant: row.variant ?? null,
          quantity: row.quantity,
          packLabel: row.packLabel ?? null,
          packCount: row.packCount ?? null,
          shopId: row.shopId ?? null,
          shopName: await shopName(row.shopId),
          expectedUnitPricePaise: row.expectedUnitPricePaise ?? null,
          estimateUnitPricePaise: expected?.unitPricePaise ?? null,
          estimateSource: expected?.source ?? null,
          estimatePaise: expected ? Math.round(row.quantity * expected.unitPricePaise) : null,
          bought: row.bought
            ? {
                quantity: row.bought.quantity,
                packLabel: row.bought.packLabel ?? null,
                packCount: row.bought.packCount ?? null,
                variant: row.bought.variant ?? null,
                shopId: row.bought.shopId,
                shopName: (await shopName(row.bought.shopId)) ?? "",
                totalPaise: row.bought.totalPaise,
                unitPricePaise: row.bought.unitPricePaise,
                boughtByName: (await ctx.db.get(row.bought.boughtBy))?.name ?? "",
                boughtAt: row.bought.boughtAt,
              }
            : null,
        };
      }),
    );
    rows.sort((a, b) => a.categoryRank - b.categoryRank || a.itemName.localeCompare(b.itemName));
    const bills = shopBills(
      rows.map((r) => ({
        shopId: r.shopId ?? undefined,
        estimatePaise: r.estimatePaise,
        bought: r.bought ? { shopId: r.bought.shopId, totalPaise: r.bought.totalPaise } : undefined,
      })),
    );
    return {
      scopeKey,
      rows,
      bills: await Promise.all(bills.map(async (b) => ({ ...b, shopName: b.shopId ? await shopName(b.shopId as Id<"shops">) : null }))),
      totals: {
        items: rows.length,
        estimatedPaise: bills.reduce((sum, b) => sum + b.estimatedPaise, 0),
        unpriced: bills.reduce((sum, b) => sum + b.unpriced, 0),
        boughtItems: rows.filter((r) => r.bought).length,
        boughtPaise: rows.reduce((sum, r) => sum + (r.bought?.totalPaise ?? 0), 0),
      },
    };
  },
});

// ---------------------------------------------------------------------------
// List mode
// ---------------------------------------------------------------------------

/** Adds an item to a list (the shop defaults to the item's default shop). */
export const add = memberMutation({
  args: {
    scope: vScope,
    itemId: v.id("items"),
    ...vQuantityInput,
    shopId: v.optional(v.id("shops")),
    expectedUnitPricePaise: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { member } = ctx;
    const organizationId = member.organization._id;
    const { scopeKey, propertyId } = resolveScope(member, args.scope);
    const item = await loadItem(ctx, member, args.itemId);
    if (item.archived) throw appError("INVALID_INPUT", `"${item.name}" is archived.`);
    const { variant, quantity, packLabel, packCount } = checkQuantity(item, args);
    const existing = await rowsOf(ctx, organizationId, scopeKey);
    if (existing.length >= MAX_LIST_ROWS)
      throw appError("INVALID_INPUT", `A list can have at most ${MAX_LIST_ROWS} items.`);
    if (existing.some((r) => r.itemId === item._id && (r.variant ?? null) === (variant ?? null)))
      throw appError("CONFLICT", `${item.name}${variant ? ` (${variant})` : ""} is already on this list.`);
    const shopId = await checkShop(
      ctx,
      member,
      args.shopId ?? (item.defaultShopId && !(await ctx.db.get(item.defaultShopId))?.archived ? item.defaultShopId : undefined),
    );
    return await ctx.db.insert("shoppingListItems", {
      organizationId,
      scopeKey,
      propertyId,
      itemId: item._id,
      variant,
      quantity,
      packLabel,
      packCount,
      shopId,
      expectedUnitPricePaise: checkExpectedPrice(args.expectedUnitPricePaise),
      addedBy: member.userId,
      createdAt: Date.now(),
    });
  },
});

/** Changes a planned item: variant, quantity, shop, expected price. Also used in Buy mode to change the shop. */
export const update = memberMutation({
  args: {
    rowId: v.id("shoppingListItems"),
    ...vQuantityInput,
    /** Leave out for "no shop chosen". */
    shopId: v.optional(v.id("shops")),
    /** Leave out to estimate from the last price paid. */
    expectedUnitPricePaise: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { member } = ctx;
    const row = await loadRow(ctx, member, args.rowId);
    const item = await loadItem(ctx, member, row.itemId);
    const { variant, quantity, packLabel, packCount } = checkQuantity(item, args, row.variant);
    if (
      (variant ?? null) !== (row.variant ?? null) &&
      (await rowsOf(ctx, row.organizationId, row.scopeKey)).some(
        (r) => r._id !== row._id && r.itemId === row.itemId && (r.variant ?? null) === (variant ?? null),
      )
    )
      throw appError("CONFLICT", `${item.name}${variant ? ` (${variant})` : ""} is already on this list.`);
    await ctx.db.patch(row._id, {
      variant,
      quantity,
      packLabel,
      packCount,
      shopId: await checkShop(ctx, member, args.shopId, row.shopId),
      expectedUnitPricePaise: checkExpectedPrice(args.expectedUnitPricePaise),
      updatedBy: member.userId,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const remove = memberMutation({
  args: { rowId: v.id("shoppingListItems") },
  handler: async (ctx, { rowId }) => {
    const row = await loadRow(ctx, ctx.member, rowId);
    await ctx.db.delete(row._id);
    return null;
  },
});

// ---------------------------------------------------------------------------
// Buy mode
// ---------------------------------------------------------------------------

/** Ticks an item off: what was actually bought (quantity, variant, shop) and the amount paid. */
export const tick = memberMutation({
  args: {
    rowId: v.id("shoppingListItems"),
    ...vQuantityInput,
    shopId: v.id("shops"),
    totalPaise: v.number(),
  },
  handler: async (ctx, args) => {
    const { member } = ctx;
    const row = await loadRow(ctx, member, args.rowId);
    const item = await loadItem(ctx, member, row.itemId);
    if (item.archived) throw appError("INVALID_INPUT", `"${item.name}" is archived.`);
    const { variant, quantity, packLabel, packCount } = checkQuantity(item, args, row.variant);
    if (!Number.isSafeInteger(args.totalPaise) || args.totalPaise <= 0 || args.totalPaise > MAX_LINE_PAISE)
      throw appError("INVALID_INPUT", `Enter the amount paid for ${item.name}.`);
    const shopId = (await checkShop(ctx, member, args.shopId))!;
    await ctx.db.patch(row._id, {
      bought: {
        quantity,
        packLabel,
        packCount,
        variant,
        shopId,
        totalPaise: args.totalPaise,
        unitPricePaise: unitPricePaise(args.totalPaise, quantity),
        boughtBy: member.userId,
        boughtAt: Date.now(),
      },
    });
    return null;
  },
});

export const untick = memberMutation({
  args: { rowId: v.id("shoppingListItems") },
  handler: async (ctx, { rowId }) => {
    const row = await loadRow(ctx, ctx.member, rowId);
    if (row.bought) await ctx.db.patch(row._id, { bought: undefined });
    return null;
  },
});

/**
 * "Save purchases": every ticked item becomes part of an entry, one entry per
 * shop, for this list's property (or Shared). Unusual prices must be
 * confirmed, as on New entry. The ticks are then cleared and the items stay
 * on the list for next time.
 */
export const savePurchases = memberMutation({
  args: { scope: vScope, pricesConfirmed: v.boolean(), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { member } = ctx;
    const { scopeKey } = resolveScope(member, args.scope);
    const bought = (await rowsOf(ctx, member.organization._id, scopeKey)).filter((r) => r.bought);
    if (bought.length === 0) throw appError("INVALID_INPUT", "Nothing has been ticked off yet.");
    const byShop = new Map<Id<"shops">, Doc<"shoppingListItems">[]>();
    for (const row of bought) {
      const shopRows = byShop.get(row.bought!.shopId) ?? [];
      shopRows.push(row);
      byShop.set(row.bought!.shopId, shopRows);
    }
    const saved: { entryId: Id<"entries">; shopId: Id<"shops">; items: number; totalPaise: number }[] = [];
    for (const [shopId, rows] of byShop) {
      for (let start = 0; start < rows.length; start += MAX_LINES) {
        const chunk = rows.slice(start, start + MAX_LINES);
        const entryId = await insertEntry(ctx, member, {
          scope: args.scope as Scope,
          shopId,
          note: args.note,
          pricesConfirmed: args.pricesConfirmed,
          lines: chunk.map((r) => ({
            itemId: r.itemId,
            variant: r.bought!.variant,
            ...(r.bought!.packLabel !== undefined
              ? { packLabel: r.bought!.packLabel, packCount: r.bought!.packCount }
              : { quantity: r.bought!.quantity }),
            totalPaise: r.bought!.totalPaise,
          })),
        });
        saved.push({ entryId, shopId, items: chunk.length, totalPaise: chunk.reduce((sum, r) => sum + r.bought!.totalPaise, 0) });
      }
    }
    for (const row of bought) await ctx.db.patch(row._id, { bought: undefined });
    return saved;
  },
});
