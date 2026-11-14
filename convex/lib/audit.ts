import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export type AuditAction =
  | "setup.first_admin_created"
  | "user.password_changed"
  | "organization.created"
  | "organization.renamed"
  | "property.added"
  | "property.renamed"
  | "account.created"
  | "account.updated"
  | "account.password_reset"
  | "account.deactivated"
  | "account.reactivated"
  | "category.created"
  | "category.updated"
  | "item.created"
  | "item.updated"
  | "item.verified"
  | "item.merged"
  | "item.deleted"
  | "shop.created"
  | "shop.updated"
  | "shop.verified"
  | "shop.merged"
  | "entry.created"
  | "entry.updated"
  | "entry.deleted"
  | "report.exported"
  | "sso.signed_in"
  | "sso.access_revoked";

/**
 * Appends one entry to the admin audit log. Never put passwords, tokens or
 * other secrets in `metadata`.
 */
export async function writeAudit(
  ctx: Pick<MutationCtx, "db">,
  entry: {
    /** The organisation the action belongs to (undefined only for setup outside any organisation). */
    organizationId: Id<"organizations"> | undefined;
    actorUserId: Id<"users"> | undefined;
    action: AuditAction;
    entityType: string;
    entityId: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await ctx.db.insert("auditLog", { ...entry, createdAt: Date.now() });
}
