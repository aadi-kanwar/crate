/**
 * Master lists (organisation-wide): categories, items and shops.
 *
 * - Everyone who makes entries reads the lists (`forEntry`) and can add an
 *   item or shop while entering. Added by a manager or kitchen staff member,
 *   it is "unverified" until an admin verifies, edits or merges it.
 * - Admins manage everything else: categories (add, rename, reorder,
 *   archive), items and shops (edit, verify, archive, merge).
 * - Archived items and shops are hidden from entry search but keep their
 *   history. Merging moves every line and entry onto the item/shop kept,
 *   then deletes the duplicate.
 *
 * Every change is in the audit log with before/after values.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import {
  adminMutation,
  adminQuery,
  memberMutation,
  memberQuery,
} from "./lib/functions";
import { categoryLabels, countsWithSubcategories, orderedCategories } from "./lib/categories";
import { MAX_QUANTITY, searchKey, tidyQuantity } from "./lib/purchases";
import { isIsoDate } from "./lib/history";
import {
  vBaseUnit,
  vPackSize,
  vReferencePrice,
  vShopType,
  type PackSize,
} from "./lib/validators";

type Db = Pick<QueryCtx, "db">;
type WriteDb = Pick<MutationCtx, "db">;

export const MAX_NAME = 60;
const MAX_LIST = 30;
const MAX_LIST_TEXT = 40;

/** A tidy name (spaces collapsed), or INVALID_INPUT. */
function cleanName(raw: string, what: string, max = MAX_NAME): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 1) throw appError("INVALID_INPUT", `Enter ${what}.`);
  if (name.length > max)
    throw appError("INVALID_INPUT", `Use at most ${max} characters for ${what}.`);
  return name;
}

/** Trimmed, non-empty, without repeats (ignoring case), and not equal to `except`. */
function cleanList(values: readonly string[], what: string, except?: string): string[] {
  const seen = new Set<string>(except ? [searchKey(except)] : []);
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim().replace(/\s+/g, " ");
    if (value.length === 0) continue;
    if (value.length > MAX_LIST_TEXT)
      throw appError("INVALID_INPUT", `Use at most ${MAX_LIST_TEXT} characters for each ${what}.`);
    const key = searchKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  if (out.length > MAX_LIST)
    throw appError("INVALID_INPUT", `An item can have at most ${MAX_LIST} ${what}s.`);
  return out;
}

function cleanPacks(packs: readonly PackSize[]): PackSize[] {
  const seen = new Set<string>();
  const out: PackSize[] = [];
  for (const pack of packs) {
    const label = pack.label.trim().replace(/\s+/g, " ");
    if (label.length === 0) continue;
    if (label.length > MAX_LIST_TEXT)
      throw appError("INVALID_INPUT", `Use at most ${MAX_LIST_TEXT} characters for a pack name.`);
    const quantity = tidyQuantity(pack.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > MAX_QUANTITY)
      throw appError("INVALID_INPUT", `"${label}" needs a quantity above zero.`);
    const key = searchKey(label);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, quantity });
  }
  if (out.length > MAX_LIST)
    throw appError("INVALID_INPUT", `An item can have at most ${MAX_LIST} pack sizes.`);
  return out;
}

async function categoriesOf(ctx: Db, organizationId: Id<"organizations">) {
  return await ctx.db
    .query("categories")
    .withIndex("by_org_order", (q) => q.eq("organizationId", organizationId))
    .collect();
}

async function itemsOf(ctx: Db, organizationId: Id<"organizations">) {
  return await ctx.db
    .query("items")
    .withIndex("by_org", (q) => q.eq("organizationId", organizationId))
    .collect();
}

async function shopsOf(ctx: Db, organizationId: Id<"organizations">) {
  return await ctx.db
    .query("shops")
    .withIndex("by_org", (q) => q.eq("organizationId", organizationId))
    .collect();
}

async function loadCategory(ctx: Db, organizationId: Id<"organizations">, id: Id<"categories">) {
  const row = await ctx.db.get(id);
  if (row === null || row.organizationId !== organizationId) throw appError("NOT_FOUND");
  return row;
}

async function loadItem(ctx: Db, organizationId: Id<"organizations">, id: Id<"items">) {
  const row = await ctx.db.get(id);
  if (row === null || row.organizationId !== organizationId) throw appError("NOT_FOUND");
  return row;
}

async function loadShop(ctx: Db, organizationId: Id<"organizations">, id: Id<"shops">) {
  const row = await ctx.db.get(id);
  if (row === null || row.organizationId !== organizationId) throw appError("NOT_FOUND");
  return row;
}

/** Refuses a second live item/shop with the same name (archived ones don't count). */
function assertNewName(
  existing: readonly { _id: string; name: string; archived: boolean }[],
  name: string,
  what: string,
  exceptId?: string,
) {
  const key = searchKey(name);
  const clash = existing.find(
    (row) => !row.archived && row._id !== exceptId && searchKey(row.name) === key,
  );
  if (clash) throw appError("CONFLICT", `There's already ${what} called "${clash.name}".`);
}

const itemSnapshot = (item: Doc<"items">) => ({
  name: item.name,
  categoryId: item.categoryId,
  baseUnit: item.baseUnit,
  aliases: item.aliases,
  packSizes: item.packSizes,
  variants: item.variants,
  defaultShopId: item.defaultShopId ?? null,
  referencePrice: item.referencePrice ?? null,
  status: item.status,
  archived: item.archived,
});

const shopSnapshot = (shop: Doc<"shops">) => ({
  name: shop.name,
  type: shop.type,
  note: shop.note,
  status: shop.status,
  archived: shop.archived,
});

// ---------------------------------------------------------------------------
// For entries (everyone who makes entries).
// ---------------------------------------------------------------------------

/** What the entry screen needs: live categories, items and shops (archived ones hidden). */
export const forEntry = memberQuery({
  args: {},
  handler: async (ctx) => {
    const organizationId = ctx.member.organization._id;
    const all = await categoriesOf(ctx, organizationId);
    const labels = categoryLabels(all);
    const categories = orderedCategories(all).filter((c) => !c.archived);
    return {
      categories: categories.map((c) => ({
        categoryId: c._id,
        name: c.name,
        parentId: c.parentId ?? null,
        label: labels.get(c._id) ?? c.name,
      })),
      items: (await itemsOf(ctx, organizationId))
        .filter((i) => !i.archived)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((i) => ({
          itemId: i._id,
          name: i.name,
          categoryId: i.categoryId,
          baseUnit: i.baseUnit,
          aliases: i.aliases,
          packSizes: i.packSizes,
          variants: i.variants,
          defaultShopId: i.defaultShopId ?? null,
          referencePrice: i.referencePrice ?? null,
          verified: i.status === "verified",
        })),
      shops: (await shopsOf(ctx, organizationId))
        .filter((s) => !s.archived)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((s) => ({
          shopId: s._id,
          name: s.name,
          type: s.type,
          note: s.note ?? null,
          verified: s.status === "verified",
        })),
    };
  },
});

/** Adds an item while entering. Unverified unless an admin adds it. */
export const addItem = memberMutation({
  args: {
    name: v.string(),
    categoryId: v.id("categories"),
    baseUnit: vBaseUnit,
    aliases: v.optional(v.array(v.string())),
    defaultShopId: v.optional(v.id("shops")),
    referencePrice: v.optional(vReferencePrice),
  },
  handler: async (ctx, args) => {
    const organizationId = ctx.member.organization._id;
    const name = cleanName(args.name, "the item's name");
    const category = await loadCategory(ctx, organizationId, args.categoryId);
    if (category.archived) throw appError("INVALID_INPUT", "That category is archived.");
    const defaultShopId = await checkDefaultShop(ctx, organizationId, args.defaultShopId);
    const referencePrice = await checkReferencePrice(ctx, organizationId, args.referencePrice);
    assertNewName(await itemsOf(ctx, organizationId), name, "an item");
    const itemId = await ctx.db.insert("items", {
      organizationId,
      name,
      categoryId: category._id,
      baseUnit: args.baseUnit,
      aliases: cleanList(args.aliases ?? [], "other name", name),
      packSizes: [],
      variants: [],
      defaultShopId,
      referencePrice,
      status: ctx.member.isAdmin ? "verified" : "unverified",
      archived: false,
      createdBy: ctx.member.userId,
      createdAt: Date.now(),
    });
    await writeAudit(ctx, {
      organizationId,
      actorUserId: ctx.member.userId,
      action: "item.created",
      entityType: "items",
      entityId: itemId,
      metadata: { after: itemSnapshot((await ctx.db.get(itemId))!) },
    });
    return itemId;
  },
});

/** Adds a shop while entering. Unverified unless an admin adds it. */
export const addShop = memberMutation({
  args: { name: v.string(), type: vShopType, note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const organizationId = ctx.member.organization._id;
    const name = cleanName(args.name, "the shop's name");
    const note = args.note?.trim() ? cleanName(args.note, "the area or note", 100) : undefined;
    assertNewName(await shopsOf(ctx, organizationId), name, "a shop");
    const shopId = await ctx.db.insert("shops", {
      organizationId,
      name,
      type: args.type,
      note,
      status: ctx.member.isAdmin ? "verified" : "unverified",
      archived: false,
      createdBy: ctx.member.userId,
      createdAt: Date.now(),
    });
    await writeAudit(ctx, {
      organizationId,
      actorUserId: ctx.member.userId,
      action: "shop.created",
      entityType: "shops",
      entityId: shopId,
      metadata: { after: shopSnapshot((await ctx.db.get(shopId))!) },
    });
    return shopId;
  },
});

// ---------------------------------------------------------------------------
// Admin: the Lists screen.
// ---------------------------------------------------------------------------

/** Everything on the Lists screen, archived rows included, with how often each is used. */
export const lists = adminQuery({
  args: {},
  handler: async (ctx) => {
    const organizationId = ctx.admin.organization._id;
    const [categories, items, shops] = await Promise.all([
      categoriesOf(ctx, organizationId),
      itemsOf(ctx, organizationId),
      shopsOf(ctx, organizationId),
    ]);
    const lines = await ctx.db
      .query("entryLines")
      .withIndex("by_org_loggedAt", (q) => q.eq("organizationId", organizationId))
      .collect();
    const live = lines.filter((l) => !l.deleted);
    const linesPerItem = new Map<string, number>();
    const tripsPerShop = new Map<string, Set<string>>();
    const itemsPerCategory = new Map<string, number>();
    for (const line of live) {
      linesPerItem.set(line.itemId, (linesPerItem.get(line.itemId) ?? 0) + 1);
      const trips = tripsPerShop.get(line.shopId) ?? new Set<string>();
      trips.add(line.entryId);
      tripsPerShop.set(line.shopId, trips);
    }
    for (const item of items)
      itemsPerCategory.set(item.categoryId, (itemsPerCategory.get(item.categoryId) ?? 0) + 1);
    const categoryName = categoryLabels(categories);
    const categoryCounts = countsWithSubcategories(categories, itemsPerCategory);
    const shopName = new Map<string, string>(shops.map((sh) => [sh._id, sh.name]));
    const userIds = [...new Set([...items, ...shops].map((r) => r.createdBy).filter((id) => id !== undefined))];
    const users = new Map<string, string>();
    for (const id of userIds) users.set(id, (await ctx.db.get(id))?.name ?? "");
    return {
      categories: orderedCategories(categories).map((c) => ({
        categoryId: c._id,
        name: c.name,
        parentId: c.parentId ?? null,
        label: categoryName.get(c._id) ?? c.name,
        archived: c.archived,
        /** Items in it, including everything in its sub-categories. */
        itemCount: categoryCounts.get(c._id)?.total ?? 0,
        /** Of those, how many are in its sub-categories. */
        subcategoryItemCount: categoryCounts.get(c._id)?.inSubcategories ?? 0,
      })),
      items: items
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((i) => ({
          itemId: i._id,
          name: i.name,
          categoryId: i.categoryId,
          categoryName: categoryName.get(i.categoryId) ?? "",
          baseUnit: i.baseUnit,
          aliases: i.aliases,
          packSizes: i.packSizes,
          variants: i.variants,
          defaultShopId: i.defaultShopId ?? null,
          defaultShopName: i.defaultShopId ? (shopName.get(i.defaultShopId) ?? null) : null,
          referencePrice: i.referencePrice ?? null,
          referenceShopName: i.referencePrice?.shopId ? (shopName.get(i.referencePrice.shopId) ?? null) : null,
          verified: i.status === "verified",
          archived: i.archived,
          lineCount: linesPerItem.get(i._id) ?? 0,
          createdByName: i.createdBy ? (users.get(i.createdBy) ?? "") : "",
          createdAt: i.createdAt,
        })),
      shops: shops
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((s) => ({
          shopId: s._id,
          name: s.name,
          type: s.type,
          note: s.note ?? null,
          verified: s.status === "verified",
          archived: s.archived,
          entryCount: tripsPerShop.get(s._id)?.size ?? 0,
          createdByName: s.createdBy ? (users.get(s.createdBy) ?? "") : "",
          createdAt: s.createdAt,
        })),
    };
  },
});

// ---- Categories -------------------------------------------------------------

/** Adds a category, or a sub-category when `parentId` names a top-level category. */
export const addCategory = adminMutation({
  args: { name: v.string(), parentId: v.optional(v.id("categories")) },
  handler: async (ctx, args) => {
    const organizationId = ctx.admin.organization._id;
    const name = cleanName(args.name, "the category's name", 40);
    let parentId: Id<"categories"> | undefined;
    if (args.parentId) {
      const parent = await loadCategory(ctx, organizationId, args.parentId);
      if (parent.parentId)
        throw appError("INVALID_INPUT", "Sub-categories can only go under a main category.");
      parentId = parent._id;
    }
    const siblings = (await categoriesOf(ctx, organizationId)).filter((c) => c.parentId === parentId);
    assertNewName(siblings, name, parentId ? "a sub-category" : "a category");
    const categoryId = await ctx.db.insert("categories", {
      organizationId,
      name,
      parentId,
      sortOrder: Math.max(-1, ...siblings.map((c) => c.sortOrder)) + 1,
      archived: false,
      createdAt: Date.now(),
    });
    await writeAudit(ctx, {
      organizationId,
      actorUserId: ctx.admin.userId,
      action: "category.created",
      entityType: "categories",
      entityId: categoryId,
      metadata: { after: { name, parentId: parentId ?? null } },
    });
    return categoryId;
  },
});

/** Renames and/or archives a category. */
export const updateCategory = adminMutation({
  args: { categoryId: v.id("categories"), name: v.string(), archived: v.boolean() },
  handler: async (ctx, args) => {
    const organizationId = ctx.admin.organization._id;
    const category = await loadCategory(ctx, organizationId, args.categoryId);
    const name = cleanName(args.name, "the category's name", 40);
    const siblings = (await categoriesOf(ctx, organizationId)).filter((c) => c.parentId === category.parentId);
    assertNewName(siblings, name, category.parentId ? "a sub-category" : "a category", category._id);
    if (name === category.name && args.archived === category.archived) return null;
    await ctx.db.patch(category._id, { name, archived: args.archived });
    await writeAudit(ctx, {
      organizationId,
      actorUserId: ctx.admin.userId,
      action: "category.updated",
      entityType: "categories",
      entityId: category._id,
      metadata: {
        before: { name: category.name, archived: category.archived },
        after: { name, archived: args.archived },
      },
    });
    return null;
  },
});

/** Moves a category one place up or down among its siblings (sub-categories stay under their category). */
export const moveCategory = adminMutation({
  args: { categoryId: v.id("categories"), direction: v.union(v.literal("up"), v.literal("down")) },
  handler: async (ctx, args) => {
    const organizationId = ctx.admin.organization._id;
    const category = await loadCategory(ctx, organizationId, args.categoryId);
    const all = (await categoriesOf(ctx, organizationId))
      .filter((c) => c.parentId === category.parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const index = all.findIndex((c) => c._id === args.categoryId);
    if (index === -1) throw appError("NOT_FOUND");
    const swapWith = args.direction === "up" ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= all.length) return null;
    const order = all.map((c) => c._id);
    [order[index], order[swapWith]] = [order[swapWith], order[index]];
    for (const [position, id] of order.entries()) {
      const row = all.find((c) => c._id === id)!;
      if (row.sortOrder !== position) await ctx.db.patch(id, { sortOrder: position });
    }
    await writeAudit(ctx, {
      organizationId,
      actorUserId: ctx.admin.userId,
      action: "category.updated",
      entityType: "categories",
      entityId: args.categoryId,
      metadata: {
        before: { order: all.map((c) => c.name) },
        after: { order: order.map((id) => all.find((c) => c._id === id)!.name) },
      },
    });
    return null;
  },
});

/**
 * Saves a new order for the main categories (no `parentId`) or for the
 * sub-categories of one main category, after a drag and drop. `orderedIds`
 * must be exactly those siblings.
 */
export const reorderCategories = adminMutation({
  args: { parentId: v.optional(v.id("categories")), orderedIds: v.array(v.id("categories")) },
  handler: async (ctx, args) => {
    const organizationId = ctx.admin.organization._id;
    if (args.parentId) await loadCategory(ctx, organizationId, args.parentId);
    const siblings = (await categoriesOf(ctx, organizationId))
      .filter((c) => c.parentId === args.parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const wanted = new Set<string>(args.orderedIds);
    if (wanted.size !== args.orderedIds.length || wanted.size !== siblings.length || siblings.some((c) => !wanted.has(c._id)))
      throw appError("CONFLICT", "The categories changed meanwhile. Please try again.");
    const before = siblings.map((c) => c.name);
    let changed = false;
    for (const [position, id] of args.orderedIds.entries()) {
      const row = siblings.find((c) => c._id === id)!;
      if (row.sortOrder !== position) {
        await ctx.db.patch(id, { sortOrder: position });
        changed = true;
      }
    }
    if (!changed) return null;
    await writeAudit(ctx, {
      organizationId,
      actorUserId: ctx.admin.userId,
      action: "category.updated",
      entityType: "categories",
      entityId: args.parentId ?? "main",
      metadata: {
        before: { order: before },
        after: { order: args.orderedIds.map((id) => siblings.find((c) => c._id === id)!.name) },
      },
    });
    return null;
  },
});

// ---- Items ------------------------------------------------------------------

const vItemFields = {
  name: v.string(),
  categoryId: v.id("categories"),
  baseUnit: vBaseUnit,
  aliases: v.array(v.string()),
  packSizes: v.array(vPackSize),
  variants: v.array(v.string()),
  /** The shop it is usually bought from; leave out for none. */
  defaultShopId: v.optional(v.id("shops")),
  /** A price known from before Crate; leave out for none. */
  referencePrice: v.optional(vReferencePrice),
};

/** A sensible earlier price (above zero, a real past date, a shop of this organisation), or none. */
async function checkReferencePrice(
  ctx: Db,
  organizationId: Id<"organizations">,
  price: { unitPricePaise: number; shopId?: Id<"shops">; date?: string } | undefined,
) {
  if (price === undefined) return undefined;
  if (!Number.isSafeInteger(price.unitPricePaise) || price.unitPricePaise <= 0 || price.unitPricePaise > 100_000_000)
    throw appError("INVALID_INPUT", "Enter the earlier price above zero, or leave it empty.");
  if (price.date !== undefined && (!isIsoDate(price.date) || price.date > new Date().toISOString().slice(0, 10)))
    throw appError("INVALID_DATE", "The earlier price's date can't be in the future.");
  if (price.shopId !== undefined) await loadShop(ctx, organizationId, price.shopId);
  return { unitPricePaise: price.unitPricePaise, shopId: price.shopId, date: price.date };
}

/** A default shop of this organisation that isn't archived (or none). */
async function checkDefaultShop(ctx: Db, organizationId: Id<"organizations">, shopId: Id<"shops"> | undefined, current?: Id<"shops">) {
  if (shopId === undefined) return undefined;
  const shop = await loadShop(ctx, organizationId, shopId);
  if (shop.archived && shop._id !== current) throw appError("INVALID_INPUT", `"${shop.name}" is archived.`);
  return shop._id;
}

async function cleanItemFields(
  ctx: Db,
  organizationId: Id<"organizations">,
  args: {
    name: string;
    categoryId: Id<"categories">;
    aliases: string[];
    packSizes: PackSize[];
    variants: string[];
    defaultShopId?: Id<"shops">;
    referencePrice?: { unitPricePaise: number; shopId?: Id<"shops">; date?: string };
  },
  currentShop?: Id<"shops">,
) {
  const name = cleanName(args.name, "the item's name");
  const category = await loadCategory(ctx, organizationId, args.categoryId);
  return {
    name,
    categoryId: category._id,
    aliases: cleanList(args.aliases, "other name", name),
    packSizes: cleanPacks(args.packSizes),
    variants: cleanList(args.variants, "variant"),
    defaultShopId: await checkDefaultShop(ctx, organizationId, args.defaultShopId, currentShop),
    referencePrice: await checkReferencePrice(ctx, organizationId, args.referencePrice),
  };
}

/** Admin adds an item (verified) from the Lists screen. */
export const createItem = adminMutation({
  args: vItemFields,
  handler: async (ctx, args) => {
    const organizationId = ctx.admin.organization._id;
    const fields = await cleanItemFields(ctx, organizationId, args);
    assertNewName(await itemsOf(ctx, organizationId), fields.name, "an item");
    const itemId = await ctx.db.insert("items", {
      organizationId,
      ...fields,
      baseUnit: args.baseUnit,
      status: "verified",
      archived: false,
      createdBy: ctx.admin.userId,
      createdAt: Date.now(),
    });
    await writeAudit(ctx, {
      organizationId,
      actorUserId: ctx.admin.userId,
      action: "item.created",
      entityType: "items",
      entityId: itemId,
      metadata: { after: itemSnapshot((await ctx.db.get(itemId))!) },
    });
    return itemId;
  },
});

/**
 * Edits an item. The unit can't change once the item has been bought (old
 * quantities would mean something else). A new category is copied onto its
 * lines so the history pages stay right. `verify` also marks it verified.
 */
export const updateItem = adminMutation({
  args: { itemId: v.id("items"), archived: v.boolean(), verify: v.boolean(), ...vItemFields },
  handler: async (ctx, args) => {
    const organizationId = ctx.admin.organization._id;
    const item = await loadItem(ctx, organizationId, args.itemId);
    const fields = await cleanItemFields(ctx, organizationId, args, item.defaultShopId);
    if (!args.archived)
      assertNewName(await itemsOf(ctx, organizationId), fields.name, "an item", item._id);
    const lines = await ctx.db
      .query("entryLines")
      .withIndex("by_item_loggedAt", (q) => q.eq("itemId", item._id))
      .collect();
    if (args.baseUnit !== item.baseUnit && lines.length > 0)
      throw appError(
        "CONFLICT",
        "This item has already been bought, so its unit can't change. Add a new item instead.",
      );
    const status = args.verify ? "verified" : item.status;
    await ctx.db.patch(item._id, { ...fields, baseUnit: args.baseUnit, archived: args.archived, status });
    if (fields.categoryId !== item.categoryId)
      for (const line of lines) await ctx.db.patch(line._id, { categoryId: fields.categoryId });
    const after = itemSnapshot((await ctx.db.get(item._id))!);
    await writeAudit(ctx, {
      organizationId,
      actorUserId: ctx.admin.userId,
      action: status === "verified" && item.status !== "verified" ? "item.verified" : "item.updated",
      entityType: "items",
      entityId: item._id,
      metadata: { before: itemSnapshot(item), after },
    });
    return null;
  },
});

/**
 * Merges a duplicate item into the one kept: every purchase line moves to it,
 * the duplicate's name, other names, pack sizes and variants are added to it,
 * and the duplicate is deleted. Both must use the same unit.
 */
export const mergeItem = adminMutation({
  args: { duplicateId: v.id("items"), keepId: v.id("items") },
  handler: async (ctx, args) => {
    const organizationId = ctx.admin.organization._id;
    if (args.duplicateId === args.keepId)
      throw appError("INVALID_INPUT", "Choose a different item to keep.");
    const duplicate = await loadItem(ctx, organizationId, args.duplicateId);
    const keep = await loadItem(ctx, organizationId, args.keepId);
    if (duplicate.baseUnit !== keep.baseUnit)
      throw appError(
        "CONFLICT",
        `"${duplicate.name}" is counted in ${duplicate.baseUnit} and "${keep.name}" in ${keep.baseUnit}, so they can't be merged.`,
      );
    const lines = await ctx.db
      .query("entryLines")
      .withIndex("by_item_loggedAt", (q) => q.eq("itemId", duplicate._id))
      .collect();
    for (const line of lines)
      await ctx.db.patch(line._id, { itemId: keep._id, categoryId: keep.categoryId });
    const listRows = await ctx.db
      .query("shoppingListItems")
      .withIndex("by_item", (q) => q.eq("itemId", duplicate._id))
      .collect();
    for (const row of listRows) await ctx.db.patch(row._id, { itemId: keep._id });
    const packLabels = new Set(keep.packSizes.map((p) => searchKey(p.label)));
    await ctx.db.patch(keep._id, {
      aliases: cleanList([...keep.aliases, duplicate.name, ...duplicate.aliases], "other name", keep.name),
      variants: cleanList([...keep.variants, ...duplicate.variants], "variant"),
      packSizes: [...keep.packSizes, ...duplicate.packSizes.filter((p) => !packLabels.has(searchKey(p.label)))],
      defaultShopId: keep.defaultShopId ?? duplicate.defaultShopId,
      referencePrice: keep.referencePrice ?? duplicate.referencePrice,
    });
    await ctx.db.delete(duplicate._id);
    await writeAudit(ctx, {
      organizationId,
      actorUserId: ctx.admin.userId,
      action: "item.merged",
      entityType: "items",
      entityId: keep._id,
      metadata: {
        merged: { itemId: duplicate._id, ...itemSnapshot(duplicate) },
        into: { itemId: keep._id, name: keep.name },
        linesMoved: lines.length,
      },
    });
    return { linesMoved: lines.length };
  },
});

// ---- Shops ------------------------------------------------------------------

export const createShop = adminMutation({
  args: { name: v.string(), type: vShopType, note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const organizationId = ctx.admin.organization._id;
    const name = cleanName(args.name, "the shop's name");
    const note = args.note?.trim() ? cleanName(args.note, "the area or note", 100) : undefined;
    assertNewName(await shopsOf(ctx, organizationId), name, "a shop");
    const shopId = await ctx.db.insert("shops", {
      organizationId,
      name,
      type: args.type,
      note,
      status: "verified",
      archived: false,
      createdBy: ctx.admin.userId,
      createdAt: Date.now(),
    });
    await writeAudit(ctx, {
      organizationId,
      actorUserId: ctx.admin.userId,
      action: "shop.created",
      entityType: "shops",
      entityId: shopId,
      metadata: { after: shopSnapshot((await ctx.db.get(shopId))!) },
    });
    return shopId;
  },
});

export const updateShop = adminMutation({
  args: {
    shopId: v.id("shops"),
    name: v.string(),
    type: vShopType,
    note: v.optional(v.string()),
    archived: v.boolean(),
    verify: v.boolean(),
  },
  handler: async (ctx, args) => {
    const organizationId = ctx.admin.organization._id;
    const shop = await loadShop(ctx, organizationId, args.shopId);
    const name = cleanName(args.name, "the shop's name");
    const note = args.note?.trim() ? cleanName(args.note, "the area or note", 100) : undefined;
    if (!args.archived) assertNewName(await shopsOf(ctx, organizationId), name, "a shop", shop._id);
    const status = args.verify ? "verified" : shop.status;
    await ctx.db.patch(shop._id, { name, type: args.type, note, archived: args.archived, status });
    await writeAudit(ctx, {
      organizationId,
      actorUserId: ctx.admin.userId,
      action: status === "verified" && shop.status !== "verified" ? "shop.verified" : "shop.updated",
      entityType: "shops",
      entityId: shop._id,
      metadata: { before: shopSnapshot(shop), after: shopSnapshot((await ctx.db.get(shop._id))!) },
    });
    return null;
  },
});

/** Merges a duplicate shop into the one kept: its entries and lines move over, then it is deleted. */
export const mergeShop = adminMutation({
  args: { duplicateId: v.id("shops"), keepId: v.id("shops") },
  handler: async (ctx, args) => {
    const organizationId = ctx.admin.organization._id;
    if (args.duplicateId === args.keepId)
      throw appError("INVALID_INPUT", "Choose a different shop to keep.");
    const duplicate = await loadShop(ctx, organizationId, args.duplicateId);
    const keep = await loadShop(ctx, organizationId, args.keepId);
    const moved = await repointShop(ctx, duplicate._id, keep._id);
    await ctx.db.delete(duplicate._id);
    await writeAudit(ctx, {
      organizationId,
      actorUserId: ctx.admin.userId,
      action: "shop.merged",
      entityType: "shops",
      entityId: keep._id,
      metadata: {
        merged: { shopId: duplicate._id, ...shopSnapshot(duplicate) },
        into: { shopId: keep._id, name: keep.name },
        ...moved,
      },
    });
    return moved;
  },
});

async function repointShop(ctx: WriteDb, from: Id<"shops">, to: Id<"shops">) {
  const entries = await ctx.db
    .query("entries")
    .withIndex("by_shop", (q) => q.eq("shopId", from))
    .collect();
  for (const entry of entries) await ctx.db.patch(entry._id, { shopId: to });
  const lines = await ctx.db
    .query("entryLines")
    .withIndex("by_shop_loggedAt", (q) => q.eq("shopId", from))
    .collect();
  for (const line of lines) await ctx.db.patch(line._id, { shopId: to });
  // Items that usually come from it, and shopping lists, follow too.
  for (const item of await ctx.db
    .query("items")
    .withIndex("by_default_shop", (q) => q.eq("defaultShopId", from))
    .collect())
    await ctx.db.patch(item._id, { defaultShopId: to });
  for (const row of await ctx.db
    .query("shoppingListItems")
    .withIndex("by_shop", (q) => q.eq("shopId", from))
    .collect())
    await ctx.db.patch(row._id, { shopId: to });
  // Ticked-off rows record their own shop.
  const organizationId = (await ctx.db.get(to))!.organizationId;
  for (const row of await ctx.db
    .query("shoppingListItems")
    .withIndex("by_scope", (q) => q.eq("organizationId", organizationId))
    .collect())
    if (row.bought?.shopId === from) await ctx.db.patch(row._id, { bought: { ...row.bought, shopId: to } });
  return { entriesMoved: entries.length, linesMoved: lines.length };
}
