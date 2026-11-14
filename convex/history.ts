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
import { categoryLabels, withSubcategories } from "./lib/categories";
import { lineShares } from "./lib/purchases";
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

/**
 * How much of a line counts for a scope. "all": the whole line. A
 * property: its own lines, plus its share of Shared lines split between
 * properties. "shared": Shared lines that weren't split (split ones count
 * for the properties instead). Null when the line doesn't count there.
 */
export function shareFor(
  line: Pick<Doc<"entryLines">, "scopeKey" | "quantity" | "totalPaise" | "split">,
  scope: string,
): { quantity: number; totalPaise: number } | null {
  if (scope === "all") return { quantity: line.quantity, totalPaise: line.totalPaise };
  const isSplit = line.scopeKey === "shared" && (line.split?.length ?? 0) > 0;
  if (scope === "shared") return line.scopeKey === "shared" && !isSplit ? { quantity: line.quantity, totalPaise: line.totalPaise } : null;
  if (line.scopeKey === scope) return { quantity: line.quantity, totalPaise: line.totalPaise };
  if (!isSplit) return null;
  const share = lineShares(line).find((x) => x.scopeKey === scope);
  return share ? { quantity: share.quantity, totalPaise: share.totalPaise } : null;
}

/** Live (not deleted) lines matching the filters, oldest first, with their entries. */
async function filteredLines(ctx: Db, admin: AdminViewer, filters: Filters) {
  const organizationId = admin.organization._id;
  const scope = checkScope(admin, filters.scope);
  const { from, to } = checkRange(filters.fromDate, filters.toDate);
  const categoryIds = filters.categoryId
    ? withSubcategories(
        await ctx.db
          .query("categories")
          .withIndex("by_org_order", (q) => q.eq("organizationId", organizationId))
          .collect(),
        filters.categoryId,
      )
    : null;
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
    // The category and its sub-categories.
    rows = [];
    for (const categoryId of categoryIds!) {
      rows.push(
        ...(await ctx.db
          .query("entryLines")
          .withIndex("by_category_loggedAt", (q) =>
            q.eq("categoryId", categoryId as Id<"categories">).gte("loggedAt", from).lt("loggedAt", to),
          )
          .collect()),
      );
    }
  } else if (scope !== "all") {
    rows = await ctx.db
      .query("entryLines")
      .withIndex("by_scope_loggedAt", (q) =>
        q.eq("organizationId", organizationId).eq("scopeKey", scope).gte("loggedAt", from).lt("loggedAt", to),
      )
      .collect();
    // A property also gets its share of Shared lines split between properties.
    if (scope !== "shared")
      rows.push(
        ...(await ctx.db
          .query("entryLines")
          .withIndex("by_scope_loggedAt", (q) =>
            q.eq("organizationId", organizationId).eq("scopeKey", "shared").gte("loggedAt", from).lt("loggedAt", to),
          )
          .collect()),
      );
  } else {
    rows = await ctx.db
      .query("entryLines")
      .withIndex("by_org_loggedAt", (q) => q.eq("organizationId", organizationId).gte("loggedAt", from).lt("loggedAt", to))
      .collect();
  }
  const lines = rows
    .filter(
      (l) =>
        !l.deleted &&
        l.organizationId === organizationId &&
        (!filters.itemId || l.itemId === filters.itemId) &&
        (!filters.shopId || l.shopId === filters.shopId) &&
        (!categoryIds || categoryIds.includes(l.categoryId)),
    )
    // Each line as much of it as counts for the scope (a property's share of a split Shared line).
    .flatMap((l) => {
      const share = shareFor(l, scope);
      return share ? [{ ...l, quantity: share.quantity, totalPaise: share.totalPaise, isShare: share.totalPaise !== l.totalPaise || share.quantity !== l.quantity }] : [];
    });
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
const UNIT_NAMES: Record<string, string> = { kg: "kg", litre: "litre", piece: "piece", dozen: "dozen", cylinder: "cylinder", packet: "packet" };

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
    const categoryNames = categoryLabels(
      await ctx.db
        .query("categories")
        .withIndex("by_org_order", (q) => q.eq("organizationId", ctx.admin.organization._id))
        .collect(),
    );
    const rows: (string | number)[][] = [
      ["Date", "Time", "For", "Shop", "Shop type", "Category", "Item", "Variant", "Brand", "Quantity", "Unit", "Pack", "Pack count", "Total (Rs)", "Price per unit (Rs)", "Split between properties", "Entered by", "Note", "Entry"],
    ];
    const ordered = [...lines].sort(
      (a, b) => b.loggedAt - a.loggedAt || a.entryId.localeCompare(b.entryId) || a._creationTime - b._creationTime,
    );
    for (const line of ordered) {
      const entry = entries.get(line.entryId)!;
      const item = await get(line.itemId, () => ctx.db.get(line.itemId));
      const shop = await get(line.shopId, () => ctx.db.get(line.shopId));
      const user = await get(entry.createdBy, () => ctx.db.get(entry.createdBy));
      rows.push([
        istDay(line.loggedAt),
        formatInTimeZone(new Date(line.loggedAt), TIMEZONE, "HH:mm"),
        line.propertyId ? (properties.get(line.propertyId) ?? "") : "Shared",
        shop?.name ?? "",
        shop ? SHOP_TYPE_NAMES[shop.type] : "",
        categoryNames.get(line.categoryId) ?? "",
        item?.name ?? "",
        line.variant ?? "",
        line.brand ?? "",
        line.quantity,
        item ? UNIT_NAMES[item.baseUnit] : "",
        line.packLabel ?? "",
        line.packCount ?? "",
        (line.totalPaise / 100).toFixed(2),
        (line.unitPricePaise / 100).toFixed(2),
        (line.split ?? []).map((part) => `${properties.get(part.propertyId) ?? ""} ${part.quantity}`).join("; "),
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

/** Lines as much as counts for the scope (see shareFor). */
function sharesOf(lines: readonly Doc<"entryLines">[], scope: string): Doc<"entryLines">[] {
  return lines.flatMap((l) => {
    const share = shareFor(l, scope);
    return share ? [{ ...l, quantity: share.quantity, totalPaise: share.totalPaise }] : [];
  });
}

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
    const categoryName = categoryLabels(categories);
    const since = Date.now() - 30 * 86_400_000;
    return await Promise.all(
      allItems
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(async (item) => {
          const lines = sharesOf(await itemLines(ctx, item._id), scope);
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
    const categoryNames = categoryLabels(
      await ctx.db
        .query("categories")
        .withIndex("by_org_order", (q) => q.eq("organizationId", organizationId))
        .collect(),
    );
    const raw = await itemLines(ctx, item._id);
    const all = sharesOf(raw, scope);
    const inRange = all.filter((l) => l.loggedAt >= from && l.loggedAt < to);
    const shops = new Map<string, string>();
    for (const l of inRange) if (!shops.has(l.shopId)) shops.set(l.shopId, (await ctx.db.get(l.shopId))?.name ?? "");
    const scopeName = (key: string) =>
      key === "shared" ? "Shared" : (ctx.admin.properties.find((p) => p._id === key)?.name ?? "");
    // Usage per property (with its shares of split Shared purchases) and for unsplit Shared purchases.
    const perScope = new Map<string, { loggedAt: number; quantity: number }[]>();
    for (const line of raw) {
      if (line.loggedAt >= to) continue;
      for (const share of lineShares(line)) {
        if (scope !== "all" && share.scopeKey !== scope) continue;
        perScope.set(share.scopeKey, [...(perScope.get(share.scopeKey) ?? []), { loggedAt: line.loggedAt, quantity: share.quantity }]);
      }
    }
    const usage = [...perScope.entries()]
      .map(([key, purchases]) => ({
        scopeKey: key,
        scopeName: scopeName(key),
        purchases: purchases.length,
        rate: usageRate(purchases),
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
        categoryName: categoryNames.get(item.categoryId) ?? "",
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
        brand: l.brand ?? null,
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
