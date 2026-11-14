/**
 * Purchase entries: one shopping trip at one shop, with one or more lines.
 *
 * Who sees what (checked here, never only on screen):
 * - Admins: every entry.
 * - Managers / kitchen staff: entries for their assigned properties, and the
 *   Shared entries they made themselves.
 *
 * Rules:
 * - `loggedAt` is the moment of saving. Only an admin can change it.
 * - Managers / kitchen staff can edit or delete within 24 hours of
 *   `loggedAt`; after that only an admin can.
 * - Unit price = total ÷ quantity, computed here. A price more than twice,
 *   or under half, the median of the item's last 5 purchases must be
 *   confirmed (`pricesConfirmed`) before it is saved.
 * - Deleting is a soft delete. Every create / edit / delete is audited with
 *   before and after values.
 */
import { v, type Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import {
  memberMutation,
  memberQuery,
  organizationProperties,
  requireProperty,
  type MemberViewer,
} from "./lib/functions";
import { vSplit, type Split } from "./lib/validators";
import {
  checkPrice,
  isAllowedChoice,
  splitProblem,
  tidyQuantity,
  EDIT_WINDOW_MS,
  lineQuantity,
  MAX_LINE_PAISE,
  MAX_LINES,
  PRICE_CHECK_HISTORY,
  unitPricePaise,
  withinEditWindow,
  type PriceCheck,
} from "./lib/purchases";

type Db = Pick<QueryCtx, "db">;
type WriteDb = Pick<MutationCtx, "db">;

export const SHARED = "shared";
const MAX_NOTE = 300;

export const vScope = v.union(
  v.object({ kind: v.literal("property"), propertyId: v.id("properties") }),
  v.object({ kind: v.literal("shared") }),
);
export type Scope = Infer<typeof vScope>;

export const vLineInput = v.object({
  itemId: v.id("items"),
  variant: v.optional(v.string()),
  brand: v.optional(v.string()),
  /** Quantity in the item's base unit; leave out when using a pack size. */
  quantity: v.optional(v.number()),
  packLabel: v.optional(v.string()),
  packCount: v.optional(v.number()),
  /** Shared entries only: the quantity for each property (adds up to the quantity). */
  split: v.optional(vSplit),
  totalPaise: v.number(),
});
export type LineInput = Infer<typeof vLineInput>;

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

/** Whether this person may see the entry (deleted ones only for admins). */
export function canSee(member: MemberViewer, entry: Doc<"entries">): boolean {
  if (entry.organizationId !== member.organization._id) return false;
  if (member.isAdmin) return true;
  if (entry.deletedAt !== undefined) return false;
  if (entry.propertyId === undefined) return entry.createdBy === member.userId;
  return member.properties.some((p) => p._id === entry.propertyId);
}

/** Whether this person may edit or delete the entry now. */
export function canChange(member: MemberViewer, entry: Doc<"entries">, now: number): boolean {
  if (!canSee(member, entry) || entry.deletedAt !== undefined) return false;
  return member.isAdmin || withinEditWindow(entry.loggedAt, now);
}

async function loadVisible(ctx: Db, member: MemberViewer, entryId: Id<"entries">) {
  const entry = await ctx.db.get(entryId);
  if (entry === null || !canSee(member, entry)) throw appError("NOT_FOUND");
  return entry;
}

async function loadChangeable(ctx: Db, member: MemberViewer, entryId: Id<"entries">) {
  const entry = await loadVisible(ctx, member, entryId);
  if (entry.deletedAt !== undefined) throw appError("NOT_FOUND");
  if (!canChange(member, entry, Date.now())) throw appError("EDIT_WINDOW_CLOSED");
  return entry;
}

/** The scope's key and property, checking the person may use it. */
export function resolveScope(member: MemberViewer, scope: Scope) {
  if (scope.kind === "shared") return { scopeKey: SHARED, propertyId: undefined };
  const property = requireProperty(member, scope.propertyId);
  return { scopeKey: property._id as string, propertyId: property._id };
}

// ---------------------------------------------------------------------------
// Lines and the price check
// ---------------------------------------------------------------------------

type ResolvedLine = {
  item: Doc<"items">;
  variant?: string;
  brand?: string;
  split?: Split;
  quantity: number;
  packLabel?: string;
  packCount?: number;
  totalPaise: number;
  unitPricePaise: number;
};

/**
 * A Shared line's split between properties: only on Shared entries, only
 * the organisation's properties, parts adding up to the quantity. Parts of
 * zero are dropped; an empty split means "not split".
 */
export function checkSplit(
  split: Split | undefined,
  quantity: number,
  allowed: readonly Id<"properties">[] | null,
  where: string,
): Split | undefined {
  if (split === undefined || split.length === 0) return undefined;
  if (allowed === null) throw appError("INVALID_INPUT", `${where}: only Shared purchases can be split between properties.`);
  if (split.some((s) => !allowed.includes(s.propertyId))) throw appError("INVALID_INPUT", `${where}: that property wasn't found.`);
  const problem = splitProblem(split, quantity);
  if (problem) throw appError("INVALID_INPUT", `${where}: ${problem}`);
  const parts = split.filter((s) => s.quantity > 0).map((s) => ({ propertyId: s.propertyId, quantity: tidyQuantity(s.quantity) }));
  return parts.length > 0 ? parts : undefined;
}

/** The properties a Shared entry's lines can be split between (all of the organisation's); null for a property entry. */
export async function splitPropertiesFor(ctx: Db, organizationId: Id<"organizations">, scopeKey: string) {
  if (scopeKey !== SHARED) return null;
  return (await organizationProperties(ctx, organizationId)).map((p) => p._id);
}

/** Checks and computes every line. `existing` lines (when editing) may keep archived items or retired variants. */
async function resolveLines(
  ctx: Db,
  organizationId: Id<"organizations">,
  inputs: readonly LineInput[],
  existing: readonly Doc<"entryLines">[] = [],
  /** For a Shared entry: the organisation's properties a line may be split between. Null: no splits. */
  splitProperties: readonly Id<"properties">[] | null = null,
): Promise<ResolvedLine[]> {
  if (inputs.length === 0) throw appError("INVALID_INPUT", "Add at least one item.");
  if (inputs.length > MAX_LINES)
    throw appError("INVALID_INPUT", `An entry can have at most ${MAX_LINES} items.`);
  const out: ResolvedLine[] = [];
  for (const [index, input] of inputs.entries()) {
    const where = `Line ${index + 1}`;
    const item = await ctx.db.get(input.itemId);
    if (item === null || item.organizationId !== organizationId)
      throw appError("INVALID_INPUT", `${where}: that item wasn't found.`);
    const wasHere = existing.filter((l) => l.itemId === item._id);
    if (item.archived && wasHere.length === 0)
      throw appError("INVALID_INPUT", `${where}: "${item.name}" is archived.`);
    const variant = input.variant?.trim() || undefined;
    if (!isAllowedChoice(variant, item.variants) && !wasHere.some((l) => l.variant === variant))
      throw appError("INVALID_INPUT", `${where}: "${variant}" isn't a variant of ${item.name}.`);
    const brand = input.brand?.trim() || undefined;
    if (!isAllowedChoice(brand, item.brands ?? []) && !wasHere.some((l) => l.brand === brand))
      throw appError("INVALID_INPUT", `${where}: "${brand}" isn't a brand of ${item.name}.`);
    const quantity = lineQuantity(input, item.packSizes);
    if (quantity === null)
      throw appError("INVALID_INPUT", `${where}: enter a quantity above zero for ${item.name}.`);
    const split = checkSplit(input.split, quantity.quantity, splitProperties, `${where} (${item.name})`);
    if (!Number.isSafeInteger(input.totalPaise) || input.totalPaise <= 0 || input.totalPaise > MAX_LINE_PAISE)
      throw appError("INVALID_INPUT", `${where}: enter the amount paid for ${item.name}.`);
    out.push({
      item,
      variant,
      brand,
      split,
      ...quantity,
      totalPaise: input.totalPaise,
      unitPricePaise: unitPricePaise(input.totalPaise, quantity.quantity),
    });
  }
  return out;
}

/** Unit prices of the item's most recent purchases (same variant when one is given), newest first. */
async function recentUnitPrices(
  ctx: Db,
  itemId: Id<"items">,
  variant: string | undefined,
  excludeEntryId?: Id<"entries">,
): Promise<number[]> {
  const prices: number[] = [];
  for await (const line of ctx.db
    .query("entryLines")
    .withIndex("by_item_loggedAt", (q) => q.eq("itemId", itemId))
    .order("desc")) {
    if (line.deleted || line.entryId === excludeEntryId) continue;
    if (variant !== undefined && line.variant !== variant) continue;
    prices.push(line.unitPricePaise);
    if (prices.length >= PRICE_CHECK_HISTORY) break;
  }
  // Never bought through Crate yet: compare with the earlier price typed in, if any.
  if (prices.length === 0) {
    const reference = (await ctx.db.get(itemId))?.referencePrice;
    if (reference) prices.push(reference.unitPricePaise);
  }
  return prices;
}

async function priceChecks(
  ctx: Db,
  lines: readonly { itemId: Id<"items">; variant?: string; unitPricePaise: number }[],
  excludeEntryId?: Id<"entries">,
): Promise<PriceCheck[]> {
  return await Promise.all(
    lines.map(async (line) =>
      checkPrice(line.unitPricePaise, await recentUnitPrices(ctx, line.itemId, line.variant, excludeEntryId)),
    ),
  );
}

/**
 * The "Did you mean…?" check, for the entry screen before saving. Only
 * says high / low / fine and the usual price: never other entries.
 */
export const checkPrices = memberQuery({
  args: {
    lines: v.array(v.object({ itemId: v.id("items"), variant: v.optional(v.string()), unitPricePaise: v.number() })),
    entryId: v.optional(v.id("entries")),
  },
  handler: async (ctx, args) => {
    if (args.lines.length > MAX_LINES) throw appError("INVALID_INPUT");
    for (const line of args.lines) {
      const item = await ctx.db.get(line.itemId);
      if (item === null || item.organizationId !== ctx.member.organization._id) throw appError("NOT_FOUND");
    }
    return await priceChecks(ctx, args.lines, args.entryId);
  },
});

async function insertLines(
  ctx: WriteDb,
  entry: Doc<"entries">,
  lines: readonly ResolvedLine[],
) {
  for (const line of lines) {
    await ctx.db.insert("entryLines", {
      entryId: entry._id,
      organizationId: entry.organizationId,
      itemId: line.item._id,
      variant: line.variant,
      brand: line.brand,
      quantity: line.quantity,
      packLabel: line.packLabel,
      packCount: line.packCount,
      split: entry.scopeKey === SHARED ? line.split : undefined,
      totalPaise: line.totalPaise,
      unitPricePaise: line.unitPricePaise,
      propertyId: entry.propertyId,
      scopeKey: entry.scopeKey,
      loggedAt: entry.loggedAt,
      categoryId: line.item.categoryId,
      shopId: entry.shopId,
      deleted: entry.deletedAt !== undefined,
    });
  }
}

async function linesOf(ctx: Db, entryId: Id<"entries">) {
  return await ctx.db
    .query("entryLines")
    .withIndex("by_entry", (q) => q.eq("entryId", entryId))
    .collect();
}

/** A readable copy of the entry for the audit log (names as well as ids). */
async function snapshot(ctx: Db, entry: Doc<"entries">) {
  const lines = await linesOf(ctx, entry._id);
  const property = entry.propertyId ? await ctx.db.get(entry.propertyId) : null;
  const shop = await ctx.db.get(entry.shopId);
  return {
    scope: property?.name ?? "Shared",
    scopeKey: entry.scopeKey,
    shop: shop?.name ?? "",
    shopId: entry.shopId,
    loggedAt: entry.loggedAt,
    note: entry.note ?? null,
    totalPaise: entry.totalPaise,
    lines: await Promise.all(
      lines.map(async (l) => ({
        item: (await ctx.db.get(l.itemId))?.name ?? "",
        itemId: l.itemId,
        variant: l.variant ?? null,
        brand: l.brand ?? null,
        quantity: l.quantity,
        packLabel: l.packLabel ?? null,
        packCount: l.packCount ?? null,
        split: l.split ?? null,
        totalPaise: l.totalPaise,
        unitPricePaise: l.unitPricePaise,
      })),
    ),
  };
}

async function checkShop(ctx: Db, organizationId: Id<"organizations">, shopId: Id<"shops">, current?: Id<"shops">) {
  const shop = await ctx.db.get(shopId);
  if (shop === null || shop.organizationId !== organizationId) throw appError("INVALID_INPUT", "Choose a shop.");
  if (shop.archived && shop._id !== current) throw appError("INVALID_INPUT", `"${shop.name}" is archived.`);
  return shop;
}

function cleanNote(note: string | undefined) {
  const text = note?.trim();
  if (!text) return undefined;
  if (text.length > MAX_NOTE) throw appError("INVALID_INPUT", `Keep the note under ${MAX_NOTE} characters.`);
  return text;
}

async function requireConfirmed(
  ctx: Db,
  lines: readonly ResolvedLine[],
  confirmed: boolean,
  excludeEntryId?: Id<"entries">,
) {
  if (confirmed) return;
  const checks = await priceChecks(
    ctx,
    lines.map((l) => ({ itemId: l.item._id, variant: l.variant, unitPricePaise: l.unitPricePaise })),
    excludeEntryId,
  );
  if (checks.some((c) => c.status !== "ok")) throw appError("PRICE_CHECK_NEEDED");
}

// ---------------------------------------------------------------------------
// Create, edit, delete
// ---------------------------------------------------------------------------

/**
 * Creates an entry with all the usual checks (scope, shop, lines, price
 * check) and its audit record. Shared by New entry and the shopping list's
 * "Save purchases".
 */
export async function insertEntry(
  ctx: Pick<MutationCtx, "db">,
  member: MemberViewer,
  args: { scope: Scope; shopId: Id<"shops">; note?: string; lines: readonly LineInput[]; pricesConfirmed: boolean },
): Promise<Id<"entries">> {
  const organizationId = member.organization._id;
  const { scopeKey, propertyId } = resolveScope(member, args.scope);
  await checkShop(ctx, organizationId, args.shopId);
  const lines = await resolveLines(ctx, organizationId, args.lines, [], await splitPropertiesFor(ctx, organizationId, scopeKey));
  await requireConfirmed(ctx, lines, args.pricesConfirmed);
  const now = Date.now();
  const entryId = await ctx.db.insert("entries", {
    organizationId,
    propertyId,
    scopeKey,
    shopId: args.shopId,
    loggedAt: now,
    note: cleanNote(args.note),
    totalPaise: lines.reduce((sum, l) => sum + l.totalPaise, 0),
    lineCount: lines.length,
    createdBy: member.userId,
    createdAt: now,
  });
  const entry = (await ctx.db.get(entryId))!;
  await insertLines(ctx, entry, lines);
  await writeAudit(ctx, {
    organizationId,
    actorUserId: member.userId,
    action: "entry.created",
    entityType: "entries",
    entityId: entryId,
    metadata: { after: await snapshot(ctx, entry) },
  });
  return entryId;
}

export const create = memberMutation({
  args: {
    scope: vScope,
    shopId: v.id("shops"),
    note: v.optional(v.string()),
    lines: v.array(vLineInput),
    /** The person has seen and confirmed any "Did you mean…?" warnings. */
    pricesConfirmed: v.boolean(),
  },
  handler: async (ctx, args) => await insertEntry(ctx, ctx.member, args),
});

/**
 * Replaces an entry's details and lines. `loggedAt` (the date and time) may
 * only be sent by an admin.
 */
export const update = memberMutation({
  args: {
    entryId: v.id("entries"),
    scope: vScope,
    shopId: v.id("shops"),
    note: v.optional(v.string()),
    lines: v.array(vLineInput),
    pricesConfirmed: v.boolean(),
    loggedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { member } = ctx;
    const organizationId = member.organization._id;
    if (args.loggedAt !== undefined && !member.isAdmin)
      throw appError("FORBIDDEN", "Only an admin can change an entry's date.");
    const entry = await loadChangeable(ctx, member, args.entryId);
    const { scopeKey, propertyId } = resolveScope(member, args.scope);
    await checkShop(ctx, organizationId, args.shopId, entry.shopId);
    const oldLines = await linesOf(ctx, entry._id);
    const lines = await resolveLines(ctx, organizationId, args.lines, oldLines, await splitPropertiesFor(ctx, organizationId, scopeKey));
    await requireConfirmed(ctx, lines, args.pricesConfirmed, entry._id);
    let loggedAt = entry.loggedAt;
    if (args.loggedAt !== undefined) {
      if (!Number.isFinite(args.loggedAt) || args.loggedAt > Date.now() + 5 * 60_000 || args.loggedAt < Date.UTC(2020, 0, 1))
        throw appError("INVALID_DATE", "Choose a date that isn't in the future.");
      loggedAt = Math.round(args.loggedAt);
    }
    const before = await snapshot(ctx, entry);
    for (const line of oldLines) await ctx.db.delete(line._id);
    await ctx.db.patch(entry._id, {
      propertyId,
      scopeKey,
      shopId: args.shopId,
      note: cleanNote(args.note),
      loggedAt,
      totalPaise: lines.reduce((sum, l) => sum + l.totalPaise, 0),
      lineCount: lines.length,
      updatedBy: member.userId,
      updatedAt: Date.now(),
    });
    const updated = (await ctx.db.get(entry._id))!;
    await insertLines(ctx, updated, lines);
    await writeAudit(ctx, {
      organizationId,
      actorUserId: member.userId,
      action: "entry.updated",
      entityType: "entries",
      entityId: entry._id,
      metadata: {
        before,
        after: await snapshot(ctx, updated),
        dateChanged: loggedAt !== entry.loggedAt,
      },
    });
    return null;
  },
});

/** Soft delete: hidden everywhere, kept (and visible to admins) for the record. */
export const remove = memberMutation({
  args: { entryId: v.id("entries") },
  handler: async (ctx, { entryId }) => {
    const { member } = ctx;
    const entry = await loadChangeable(ctx, member, entryId);
    const before = await snapshot(ctx, entry);
    const now = Date.now();
    await ctx.db.patch(entry._id, { deletedAt: now, deletedBy: member.userId, updatedBy: member.userId, updatedAt: now });
    for (const line of await linesOf(ctx, entry._id)) await ctx.db.patch(line._id, { deleted: true });
    await writeAudit(ctx, {
      organizationId: entry.organizationId,
      actorUserId: member.userId,
      action: "entry.deleted",
      entityType: "entries",
      entityId: entry._id,
      metadata: { before },
    });
    return null;
  },
});

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

async function nameOf(ctx: Db, id: Id<"users"> | undefined, cache: Map<string, string>) {
  if (id === undefined) return null;
  if (!cache.has(id)) cache.set(id, (await ctx.db.get(id))?.name ?? "");
  return cache.get(id)!;
}

/** One row of an entries list (shared by the home screen and the admin log). */
export async function entrySummary(
  ctx: Db,
  member: MemberViewer,
  entry: Doc<"entries">,
  names: Map<string, string>,
  now: number,
) {
  const lines = await linesOf(ctx, entry._id);
  const itemNames: string[] = [];
  for (const line of lines.slice(0, 4)) itemNames.push((await ctx.db.get(line.itemId))?.name ?? "");
  const property = entry.propertyId ? member.properties.find((p) => p._id === entry.propertyId) ?? (await ctx.db.get(entry.propertyId)) : null;
  return {
    entryId: entry._id,
    scopeKey: entry.scopeKey,
    scopeName: property?.name ?? "Shared",
    shopName: (await ctx.db.get(entry.shopId))?.name ?? "",
    loggedAt: entry.loggedAt,
    totalPaise: entry.totalPaise,
    lineCount: entry.lineCount,
    itemNames,
    createdByName: await nameOf(ctx, entry.createdBy, names),
    deleted: entry.deletedAt !== undefined,
    canEdit: canChange(member, entry, now),
    locked: !withinEditWindow(entry.loggedAt, now),
  };
}

/**
 * Recent entries for the home screen: the person's properties and their own
 * Shared entries, newest first.
 */
export const recent = memberQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { member } = ctx;
    const organizationId = member.organization._id;
    const limit = Math.min(Math.max(1, Math.floor(args.limit ?? 30)), 100);
    const found: Doc<"entries">[] = [];
    for (const property of member.properties) {
      found.push(
        ...(await ctx.db
          .query("entries")
          .withIndex("by_scope_loggedAt", (q) => q.eq("organizationId", organizationId).eq("scopeKey", property._id))
          .order("desc")
          .filter((q) => q.eq(q.field("deletedAt"), undefined))
          .take(limit)),
      );
    }
    found.push(
      ...(await ctx.db
        .query("entries")
        .withIndex("by_createdBy_loggedAt", (q) => q.eq("createdBy", member.userId))
        .order("desc")
        .filter((q) => q.and(q.eq(q.field("scopeKey"), SHARED), q.eq(q.field("deletedAt"), undefined)))
        .take(limit)),
    );
    const now = Date.now();
    const names = new Map<string, string>();
    const rows = found.sort((a, b) => b.loggedAt - a.loggedAt).slice(0, limit);
    return await Promise.all(rows.map((e) => entrySummary(ctx, member, e, names, now)));
  },
});

/** One entry with its lines, for the detail and edit screens. Null if it isn't there or isn't yours to see. */
export const get = memberQuery({
  args: { entryId: v.id("entries") },
  handler: async (ctx, { entryId }) => {
    const { member } = ctx;
    const entry = await ctx.db.get(entryId);
    if (entry === null || !canSee(member, entry)) return null;
    const now = Date.now();
    const names = new Map<string, string>();
    const property = entry.propertyId ? await ctx.db.get(entry.propertyId) : null;
    const shop = await ctx.db.get(entry.shopId);
    const lines = await linesOf(ctx, entry._id);
    return {
      entryId: entry._id,
      scope: entry.propertyId
        ? ({ kind: "property", propertyId: entry.propertyId } as const)
        : ({ kind: "shared" } as const),
      scopeName: property?.name ?? "Shared",
      shopId: entry.shopId,
      shopName: shop?.name ?? "",
      note: entry.note ?? null,
      loggedAt: entry.loggedAt,
      totalPaise: entry.totalPaise,
      createdByName: await nameOf(ctx, entry.createdBy, names),
      createdAt: entry.createdAt,
      updatedByName: await nameOf(ctx, entry.updatedBy, names),
      updatedAt: entry.updatedAt ?? null,
      deleted: entry.deletedAt !== undefined,
      canEdit: canChange(member, entry, now),
      canChangeDate: member.isAdmin,
      editableUntil: member.isAdmin ? null : entry.loggedAt + EDIT_WINDOW_MS,
      lines: await Promise.all(
        lines.map(async (l) => {
          const item = await ctx.db.get(l.itemId);
          return {
            itemId: l.itemId,
            itemName: item?.name ?? "",
            baseUnit: item?.baseUnit ?? "piece",
            variant: l.variant ?? null,
            brand: l.brand ?? null,
            quantity: l.quantity,
            packLabel: l.packLabel ?? null,
            packCount: l.packCount ?? null,
            split: await Promise.all(
              (l.split ?? []).map(async (part) => ({
                propertyId: part.propertyId,
                propertyName: (await ctx.db.get(part.propertyId))?.name ?? "",
                quantity: part.quantity,
              })),
            ),
            totalPaise: l.totalPaise,
            unitPricePaise: l.unitPricePaise,
          };
        }),
      ),
    };
  },
});

/** Every property of the organisation (names only), for splitting a Shared purchase between them. */
export const splitTargets = memberQuery({
  args: {},
  handler: async (ctx) =>
    (await organizationProperties(ctx, ctx.member.organization._id)).map((p) => ({ propertyId: p._id, name: p.name })),
});
