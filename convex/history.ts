/**
 * Admin statistics: the entries log (with totals and CSV download), the item
 * list and the item page (quantity per week / month, approximate usage, price
 * history). Admins only: every function here is an admin wrapper, so managers
 * and kitchen staff get FORBIDDEN.
 *
 * "Scope" filter: "all" (the organisation), "shared" (Shared entries only) or
 * a property id. Shared entries are never split across properties.
 */
import { v, type Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { entrySummary } from "./entries";
import { writeAudit } from "./lib/audit";
import { toCsv } from "./lib/csv";
import { appError } from "./lib/errors";
import { adminMutation, adminQuery, type AdminViewer } from "./lib/functions";
import {
  addDays,
  bucketTotals,
  isIsoDate,
  istDay,
  istStart,
  usageRate,
} from "./lib/history";
import { formatInTimeZone } from "date-fns-tz";
import { TIMEZONE } from "./lib/time";

type Db = Pick<QueryCtx, "db">;

export const MAX_RANGE_DAYS = 400;
const MAX_LOG_ROWS = 300;

export const vFilters = {
  /** "all", "shared" or a property id. */
  scope: v.string(),
  fromDate: v.string(),
  toDate: v.string(),
  categoryId: v.optional(v.id("categories")),
  shopId: v.optional(v.id("shops")),
  itemId: v.optional(v.id("items")),
  enteredBy: v.optional(v.id("users")),
};
export const vFiltersObject = v.object(vFilters);
export type Filters = Infer<typeof vFiltersObject>;

/** "all" | "shared" | a property of the admin's organisation; anything else is refused. */
function checkScope(admin: AdminViewer, scope: string): string {
  if (scope === "all" || scope === "shared") return scope;
  if (!admin.properties.some((p) => p._id === scope)) throw appError("FORBIDDEN");
  return scope;
}

function checkRange(fromDate: string, toDate: string) {
  if (!isIsoDate(fromDate) || !isIsoDate(toDate) || fromDate > toDate)
    throw appError("INVALID_DATE", "Choose a start date on or before the end date.");
  if (istStart(toDate) - istStart(fromDate) > MAX_RANGE_DAYS * 86_400_000)
    throw appError("INVALID_DATE", `Choose at most ${MAX_RANGE_DAYS} days.`);
  return { from: istStart(fromDate), to: istStart(addDays(toDate, 1)) };
}

/** Live (not deleted) lines matching the filters, oldest first, with their entries. */
async function filteredLines(ctx: Db, admin: AdminViewer, filters: Filters) {
  const organizationId = admin.organization._id;
  const scope = checkScope(admin, filters.scope);
  const { from, to } = checkRange(filters.fromDate, filters.toDate);
  let rows: Doc<"entryLines">[];
  if (filters.itemId) {
    const itemId = filters.itemId;
    rows = await ctx.db
      .query("entryLines")
      .withIndex("by_item_loggedAt", (q) => q.eq("itemId", itemId).gte("loggedAt", from).lt("loggedAt", to))
      .collect();
  } else if (filters.shopId) {
    const shopId = filters.shopId;
    rows = await ctx.db
      .query("entryLines")
      .withIndex("by_shop_loggedAt", (q) => q.eq("shopId", shopId).gte("loggedAt", from).lt("loggedAt", to))
      .collect();
  } else if (filters.categoryId) {
    const categoryId = filters.categoryId;
    rows = await ctx.db
      .query("entryLines")
      .withIndex("by_category_loggedAt", (q) => q.eq("categoryId", categoryId).gte("loggedAt", from).lt("loggedAt", to))
      .collect();
  } else if (scope !== "all") {
    rows = await ctx.db
      .query("entryLines")
      .withIndex("by_scope_loggedAt", (q) =>
        q.eq("organizationId", organizationId).eq("scopeKey", scope).gte("loggedAt", from).lt("loggedAt", to),
      )
      .collect();
  } else {
    rows = await ctx.db
      .query("entryLines")
      .withIndex("by_org_loggedAt", (q) => q.eq("organizationId", organizationId).gte("loggedAt", from).lt("loggedAt", to))
      .collect();
  }
  const lines = rows.filter(
    (l) =>
      !l.deleted &&
      l.organizationId === organizationId &&
      (scope === "all" || l.scopeKey === scope) &&
      (!filters.itemId || l.itemId === filters.itemId) &&
      (!filters.shopId || l.shopId === filters.shopId) &&
      (!filters.categoryId || l.categoryId === filters.categoryId),
  );
  const entries = new Map<string, Doc<"entries">>();
  for (const line of lines) {
    if (!entries.has(line.entryId)) {
      const entry = await ctx.db.get(line.entryId);
      if (entry) entries.set(line.entryId, entry);
    }
  }
  const kept = lines.filter((l) => {
    const entry = entries.get(l.entryId);
    return entry !== undefined && entry.deletedAt === undefined && (!filters.enteredBy || entry.createdBy === filters.enteredBy);
  });
  return { lines: kept.sort((a, b) => a.loggedAt - b.loggedAt), entries };
}

/** The admin as a "member" for entry summaries (sees and changes everything). */
function asMember(admin: AdminViewer) {
  return { ...admin, isAdmin: true };
}

/**
 * The entries log: entries with at least one matching line, newest first
 * (up to 300 shown), and totals for everything that matches. With an item,
 * category or shop filter, amounts count only the matching lines.
 */
export const entriesLog = adminQuery({
  args: vFilters,
  handler: async (ctx, filters) => {
    const { lines, entries } = await filteredLines(ctx, ctx.admin, filters);
    const matching = new Map<string, { lines: number; totalPaise: number }>();
    for (const line of lines) {
      const m = matching.get(line.entryId) ?? { lines: 0, totalPaise: 0 };
      m.lines += 1;
      m.totalPaise += line.totalPaise;
      matching.set(line.entryId, m);
    }
    const ordered = [...matching.keys()]
      .map((id) => entries.get(id)!)
      .sort((a, b) => b.loggedAt - a.loggedAt);
    const now = Date.now();
    const names = new Map<string, string>();
    const member = asMember(ctx.admin);
    const rows = await Promise.all(
      ordered.slice(0, MAX_LOG_ROWS).map(async (entry) => ({
        ...(await entrySummary(ctx, member, entry, names, now)),
        matchingLines: matching.get(entry._id)!.lines,
        matchingPaise: matching.get(entry._id)!.totalPaise,
      })),
    );
    return {
      totals: {
        entries: ordered.length,
        lines: lines.length,
        totalPaise: lines.reduce((sum, l) => sum + l.totalPaise, 0),
      },
      rows,
      truncated: ordered.length > MAX_LOG_ROWS,
    };
  },
});

const SHOP_TYPE_NAMES: Record<string, string> = {
  wholesaler: "Wholesaler",
  kirana: "Kirana",
  mandi: "Mandi / Vendor",
  dairy: "Dairy",
  lpg_agency: "LPG agency",
  other: "Other",
};
const UNIT_NAMES: Record<string, string> = { kg: "kg", litre: "litre", piece: "piece", dozen: "dozen", cylinder: "cylinder" };

/** Spreadsheet (CSV) of the filtered log: one row per line item. Recorded in the audit log. */
export const exportCsv = adminMutation({
  args: vFilters,
  handler: async (ctx, filters) => {
    const { lines, entries } = await filteredLines(ctx, ctx.admin, filters);
    const cache = new Map<string, unknown>();
    const get = async <T,>(id: string, load: () => Promise<T>) => {
      if (!cache.has(id)) cache.set(id, await load());
      return cache.get(id) as T;
    };
    const properties = new Map<string, string>(ctx.admin.properties.map((p) => [p._id, p.name]));
    const rows: (string | number)[][] = [
      ["Date", "Time", "For", "Shop", "Shop type", "Category", "Item", "Variant", "Quantity", "Unit", "Pack", "Pack count", "Total (Rs)", "Price per unit (Rs)", "Entered by", "Note", "Entry"],
    ];
    const ordered = [...lines].sort(
      (a, b) => b.loggedAt - a.loggedAt || a.entryId.localeCompare(b.entryId) || a._creationTime - b._creationTime,
    );
    for (const line of ordered) {
      const entry = entries.get(line.entryId)!;
      const item = await get(line.itemId, () => ctx.db.get(line.itemId));
      const shop = await get(line.shopId, () => ctx.db.get(line.shopId));
      const category = await get(line.categoryId, () => ctx.db.get(line.categoryId));
      const user = await get(entry.createdBy, () => ctx.db.get(entry.createdBy));
      rows.push([
        istDay(line.loggedAt),
        formatInTimeZone(new Date(line.loggedAt), TIMEZONE, "HH:mm"),
        line.propertyId ? (properties.get(line.propertyId) ?? "") : "Shared",
        shop?.name ?? "",
        shop ? SHOP_TYPE_NAMES[shop.type] : "",
        category?.name ?? "",
        item?.name ?? "",
        line.variant ?? "",
        line.quantity,
        item ? UNIT_NAMES[item.baseUnit] : "",
        line.packLabel ?? "",
        line.packCount ?? "",
        (line.totalPaise / 100).toFixed(2),
        (line.unitPricePaise / 100).toFixed(2),
        user?.name ?? "",
        entry.note ?? "",
        entry._id,
      ]);
    }
    await writeAudit(ctx, {
      organizationId: ctx.admin.organization._id,
      actorUserId: ctx.admin.userId,
      action: "report.exported",
      entityType: "entries",
      entityId: "csv",
      metadata: { filters, rows: rows.length - 1 },
    });
    return {
      filename: `crate-entries-${filters.fromDate}-to-${filters.toDate}.csv`,
      csv: toCsv(rows),
      rows: rows.length - 1,
    };
  },
});

async function itemLines(ctx: Db, itemId: Id<"items">) {
  return (
    await ctx.db
      .query("entryLines")
      .withIndex("by_item_loggedAt", (q) => q.eq("itemId", itemId))
      .collect()
  ).filter((l) => !l.deleted);
}

/** Every item with how often, how recently and at what price it was bought (in the scope). */
export const items = adminQuery({
  args: { scope: v.string() },
  handler: async (ctx, args) => {
    const organizationId = ctx.admin.organization._id;
    const scope = checkScope(ctx.admin, args.scope);
    const [allItems, categories] = await Promise.all([
      ctx.db.query("items").withIndex("by_org", (q) => q.eq("organizationId", organizationId)).collect(),
      ctx.db.query("categories").withIndex("by_org_order", (q) => q.eq("organizationId", organizationId)).collect(),
    ]);
    const categoryName = new Map<string, string>(categories.map((c) => [c._id, c.name]));
    const since = Date.now() - 30 * 86_400_000;
    return await Promise.all(
      allItems
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(async (item) => {
          const lines = (await itemLines(ctx, item._id)).filter((l) => scope === "all" || l.scopeKey === scope);
          const last = lines[lines.length - 1];
          const recent = lines.filter((l) => l.loggedAt >= since);
          return {
            itemId: item._id,
            name: item.name,
            aliases: item.aliases,
            categoryId: item.categoryId,
            categoryName: categoryName.get(item.categoryId) ?? "",
            baseUnit: item.baseUnit,
            archived: item.archived,
            purchases: lines.length,
            lastBoughtAt: last?.loggedAt ?? null,
            lastUnitPricePaise: last?.unitPricePaise ?? null,
            last30Quantity: recent.reduce((sum, l) => sum + l.quantity, 0),
            last30Paise: recent.reduce((sum, l) => sum + l.totalPaise, 0),
          };
        }),
    );
  },
});

/**
 * One item's history in the scope and date range: totals, quantity per week
 * and per month, every purchase (for the price chart, with shop and
 * variant), and the approximate usage rate per scope (from all its
 * purchases up to the end of the range).
 */
export const item = adminQuery({
  args: { itemId: v.id("items"), scope: v.string(), fromDate: v.string(), toDate: v.string() },
  handler: async (ctx, args) => {
    const organizationId = ctx.admin.organization._id;
    const scope = checkScope(ctx.admin, args.scope);
    const { from, to } = checkRange(args.fromDate, args.toDate);
    const item = await ctx.db.get(args.itemId);
    if (item === null || item.organizationId !== organizationId) return null;
    const category = await ctx.db.get(item.categoryId);
    const all = (await itemLines(ctx, item._id)).filter((l) => scope === "all" || l.scopeKey === scope);
    // Lines of deleted entries are already marked deleted; double-check the entry.
    const inRange = all.filter((l) => l.loggedAt >= from && l.loggedAt < to);
    const shops = new Map<string, string>();
    for (const l of inRange) if (!shops.has(l.shopId)) shops.set(l.shopId, (await ctx.db.get(l.shopId))?.name ?? "");
    const scopeName = (key: string) =>
      key === "shared" ? "Shared" : (ctx.admin.properties.find((p) => p._id === key)?.name ?? "");
    const upToEnd = all.filter((l) => l.loggedAt < to);
    const scopeKeys = [...new Set(upToEnd.map((l) => l.scopeKey))];
    const usage = scopeKeys
      .map((key) => ({
        scopeKey: key,
        scopeName: scopeName(key),
        purchases: upToEnd.filter((l) => l.scopeKey === key).length,
        rate: usageRate(upToEnd.filter((l) => l.scopeKey === key)),
      }))
      .sort((a, b) => a.scopeName.localeCompare(b.scopeName));
    const range = { from: args.fromDate, to: args.toDate };
    const totalQuantity = inRange.reduce((sum, l) => sum + l.quantity, 0);
    const totalPaise = inRange.reduce((sum, l) => sum + l.totalPaise, 0);
    return {
      item: {
        itemId: item._id,
        name: item.name,
        baseUnit: item.baseUnit,
        aliases: item.aliases,
        variants: item.variants,
        categoryName: category?.name ?? "",
        archived: item.archived,
        verified: item.status === "verified",
      },
      totals: {
        purchases: inRange.length,
        quantity: Math.round(totalQuantity * 1000) / 1000,
        totalPaise,
        /** Average price per unit over the range (total ÷ quantity). */
        averageUnitPricePaise: totalQuantity > 0 ? Math.round(totalPaise / totalQuantity) : null,
      },
      weekly: bucketTotals(inRange, "week", range),
      monthly: bucketTotals(inRange, "month", range),
      purchases: inRange.map((l) => ({
        entryId: l.entryId,
        loggedAt: l.loggedAt,
        quantity: l.quantity,
        totalPaise: l.totalPaise,
        unitPricePaise: l.unitPricePaise,
        variant: l.variant ?? null,
        shopId: l.shopId,
        shopName: shops.get(l.shopId) ?? "",
        scopeName: scopeName(l.scopeKey),
        packLabel: l.packLabel ?? null,
        packCount: l.packCount ?? null,
      })),
      usage,
    };
  },
});
