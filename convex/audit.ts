/**
 * Admin: the audit log screen. Read-only (the log itself is append-only).
 * Newest first, a page at a time, optionally one kind of record.
 */
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { adminQuery } from "./lib/functions";

export const ENTITY_TYPES = ["entries", "items", "shops", "categories", "users", "properties", "organizations"] as const;

export const list = adminQuery({
  args: {
    paginationOpts: paginationOptsValidator,
    entityType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const organizationId = ctx.admin.organization._id;
    let query = ctx.db
      .query("auditLog")
      .withIndex("by_org_createdAt", (q) => q.eq("organizationId", organizationId))
      .order("desc");
    if (args.entityType) {
      const type = args.entityType;
      query = query.filter((q) => q.eq(q.field("entityType"), type));
    }
    const result = await query.paginate(args.paginationOpts);
    const names = new Map<string, string>();
    const page = await Promise.all(
      result.page.map(async (row) => {
        let actorName: string | null = null;
        if (row.actorUserId) {
          if (!names.has(row.actorUserId))
            names.set(row.actorUserId, (await ctx.db.get(row.actorUserId))?.name ?? "");
          actorName = names.get(row.actorUserId)!;
        }
        return {
          auditId: row._id,
          createdAt: row.createdAt,
          action: row.action,
          entityType: row.entityType,
          entityId: row.entityId,
          actorName,
          metadata: (row.metadata ?? null) as Record<string, unknown> | null,
        };
      }),
    );
    return { ...result, page };
  },
});
