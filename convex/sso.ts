import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { internalMutation, viewerQuery } from "./lib/functions";
import { SSO_SESSION_MS, SSO_USED_TICKET_RETENTION_MS } from "./lib/ssoTicket";

/**
 * Admin Hub single sign-on: what happens once a ticket's signature has been
 * checked (see convex/lib/ssoTicket.ts and the `hub-sso` provider in
 * convex/auth.ts). Copied from the Staff app, adapted to Crate's roles.
 *
 * A master admin signs in as an Admin of Crate's organisation:
 * - No account with that number: one is created, as Admin.
 * - An Admin already: unchanged (apart from the hub mark).
 * - A Manager / Warden or Kitchen Staff: Admin is ADDED. Their assigned
 *   properties are kept, and their previous role is remembered so "Revoke in
 *   all apps" can put it back. Nothing is ever downgraded.
 * - A switched-off account stays switched off (refused).
 * No other account or record is changed.
 */
export const acceptTicket = internalMutation({
  args: { jti: v.string(), hubAdminId: v.string(), phone: v.string(), name: v.string() },
  returns: v.union(v.null(), v.object({ userId: v.id("users"), sessionId: v.id("authSessions") })),
  handler: async (ctx, { jti, hubAdminId, phone, name }) => {
    const now = Date.now();

    // 1. One use per ticket. Recorded first, so even a refused ticket is spent.
    if (!(await spendJti(ctx, jti, now))) return null;

    // 2. The organisation: Crate runs a single one. Before it is set up, the
    //    master admin signs in without one and is asked to set it up.
    const organization = await ctx.db
      .query("organizations")
      .filter((q) => q.eq(q.field("status"), "active"))
      .order("asc")
      .first();
    const organizationId = organization?._id;

    // 3. The account with this number (made an Admin if it isn't one yet), or a new one.
    const existing = await ctx.db
      .query("users")
      .withIndex("phone", (q) => q.eq("phone", phone))
      .first();
    let user: Doc<"users">;
    let accountCreated = false;
    let roleGranted = false;
    let previousRole: Doc<"users">["role"] = undefined;
    if (existing === null) {
      const userId = await ctx.db.insert("users", {
        phone,
        name,
        role: "admin",
        organizationId,
      });
      user = (await ctx.db.get(userId))!;
      accountCreated = true;
      roleGranted = true;
    } else {
      user = existing;
      if (user.disabled === true) return null;
      if (user.organizationId !== undefined && user.organizationId !== organizationId) return null;
      const changes: Partial<Doc<"users">> = {};
      if (user.role !== "admin") {
        previousRole = user.role;
        changes.role = "admin";
        // Remember a manager / kitchen staff role so revoking can restore it.
        if (user.role === "manager" || user.role === "kitchen_staff") changes.roleBeforeSso = user.role;
        roleGranted = true;
        if (user.name === undefined) changes.name = name;
      }
      if (user.organizationId === undefined && organizationId !== undefined) changes.organizationId = organizationId;
      if (Object.keys(changes).length > 0) await ctx.db.patch(user._id, changes);
    }
    const userId: Id<"users"> = user._id;

    // 4. Mark the account, open a 12-hour login, and record it.
    if (user.ssoManaged !== true) await ctx.db.patch(userId, { ssoManaged: true });
    const sessionId = await ctx.db.insert("authSessions", { userId, expirationTime: now + SSO_SESSION_MS });
    await writeAudit(ctx, {
      organizationId,
      actorUserId: userId,
      action: "sso.signed_in",
      entityType: "users",
      entityId: userId,
      metadata: { hubAdminId, accountCreated, roleGranted, previousRole: previousRole ?? null },
    });
    return { userId, sessionId };
  },
});

/** One use per ticket or revoke request: false if this `jti` was seen before (and records it otherwise). */
async function spendJti(ctx: Pick<MutationCtx, "db">, jti: string, now: number): Promise<boolean> {
  const used = await ctx.db
    .query("ssoUsedTickets")
    .withIndex("by_jti", (q) => q.eq("jti", jti))
    .first();
  if (used !== null) return false;
  await ctx.db.insert("ssoUsedTickets", { jti, usedAt: now });
  return true;
}

/** True for a login opened through the Admin Hub: those last exactly 12 hours. */
const isHubSession = (session: Doc<"authSessions">) =>
  Math.abs(session.expirationTime - session._creationTime - SSO_SESSION_MS) <= 60_000;

/**
 * The hub's "Revoke in all apps" for one phone number: ends that account's
 * Admin Hub logins at once and takes back the Admin role if (and only if)
 * the hub gave it and no Crate admin has set the role since. A manager or
 * kitchen staff member gets their previous role back; an account the hub
 * created is left without a role (it can't be used). An admin who had their
 * own Crate account keeps it and their password login.
 */
export const revokeAccess = internalMutation({
  args: { jti: v.string(), phone: v.string() },
  returns: v.union(v.null(), v.object({ sessionsEnded: v.number(), adminRemoved: v.boolean() })),
  handler: async (ctx, { jti, phone }) => {
    const now = Date.now();
    if (!(await spendJti(ctx, jti, now))) return null;

    let sessionsEnded = 0;
    let adminRemoved = false;
    const users = await ctx.db.query("users").withIndex("phone", (q) => q.eq("phone", phone)).collect();
    for (const user of users) {
      if (user.ssoManaged !== true) continue;

      let ended = 0;
      for (const session of await ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", user._id)).collect()) {
        if (!isHubSession(session)) continue;
        const tokens = await ctx.db
          .query("authRefreshTokens")
          .withIndex("sessionIdAndParentRefreshTokenId", (q) => q.eq("sessionId", session._id))
          .collect();
        for (const token of tokens) await ctx.db.delete(token._id);
        await ctx.db.delete(session._id);
        ended += 1;
      }
      sessionsEnded += ended;

      // Did the hub give the Admin role, after any change an admin made to this account?
      const history = (
        await ctx.db
          .query("auditLog")
          .withIndex("by_entity", (q) => q.eq("entityType", "users").eq("entityId", user._id))
          .collect()
      ).sort((a, b) => a.createdAt - b.createdAt);
      const lastGrant = history.filter(
        (e) => e.action === "sso.signed_in" && (e.metadata as { roleGranted?: unknown } | undefined)?.roleGranted === true,
      ).at(-1);
      const lastManual = history.filter((e) => e.action === "account.updated").at(-1);
      const grantedByHub = lastGrant !== undefined && (lastManual === undefined || lastManual.createdAt < lastGrant.createdAt);
      const removeAdmin = grantedByHub && user.role === "admin";
      // Without a role the account can't be used at all (see access.canSignIn).
      await ctx.db.patch(
        user._id,
        removeAdmin
          ? { ssoManaged: false, role: user.roleBeforeSso, roleBeforeSso: undefined }
          : { ssoManaged: false },
      );
      if (removeAdmin) adminRemoved = true;
      await writeAudit(ctx, {
        organizationId: user.organizationId,
        actorUserId: undefined,
        action: "sso.access_revoked",
        entityType: "users",
        entityId: user._id,
        metadata: { sessionsEnded: ended, adminRemoved: removeAdmin, roleRestored: removeAdmin ? (user.roleBeforeSso ?? null) : null },
      });
    }
    return { sessionsEnded, adminRemoved };
  },
});

/** Scheduled: forgets used tickets older than 10 minutes (they expired long before). */
export const deleteOldTickets = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - SSO_USED_TICKET_RETENTION_MS;
    const old = await ctx.db
      .query("ssoUsedTickets")
      .withIndex("by_usedAt", (q) => q.lt("usedAt", cutoff))
      .take(500);
    for (const row of old) await ctx.db.delete(row._id);
    return null;
  },
});

/** The Admin Hub's address, for the "open it again from the Admin Hub" button. Not secret. */
export const hubOrigin = viewerQuery({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async () => process.env.HUB_ORIGIN ?? null,
});
