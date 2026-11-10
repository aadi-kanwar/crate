/**
 * Admin: every account (Users screen). Only admins create accounts (there is
 * no sign-up), reset passwords and switch accounts off.
 *
 * - Admin: everything, every property.
 * - Manager / Warden and Kitchen Staff: entries for the properties assigned
 *   to them (at least one).
 *
 * New accounts and password resets get a temporary password that must be
 * changed at first sign-in. You can't change your own role or switch
 * yourself off, and there is always at least one active admin. Everything
 * is in the audit log (never the passwords).
 */
import {
  invalidateSessions,
  modifyAccountCredentials,
} from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { PHONE_PASSWORD_PROVIDER } from "./auth";
import { createLogin, temporaryPassword } from "./lib/accounts";
import { writeAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import {
  adminAction,
  adminMutation,
  adminQuery,
  internalMutation,
  internalQuery,
  organizationProperties,
} from "./lib/functions";
import {
  displayNameSchema,
  normalizePhone,
  passwordProblem,
} from "./lib/inputRules";
import { vRole, type Role } from "./lib/validators";

type Db = Pick<QueryCtx, "db">;

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  manager: "Manager / Warden",
  kitchen_staff: "Kitchen Staff",
};

async function organizationUsers(
  ctx: Db,
  organizationId: Id<"organizations">,
): Promise<Doc<"users">[]> {
  return await ctx.db
    .query("users")
    .withIndex("by_org_role", (q) => q.eq("organizationId", organizationId))
    .collect();
}

async function activeAdminCount(ctx: Db, organizationId: Id<"organizations">) {
  return (
    await ctx.db
      .query("users")
      .withIndex("by_org_role", (q) =>
        q.eq("organizationId", organizationId).eq("role", "admin"),
      )
      .collect()
  ).filter((u) => u.disabled !== true).length;
}

/** An account of this organisation, else NOT_FOUND. */
async function loadAccount(
  ctx: Db,
  organizationId: Id<"organizations">,
  userId: Id<"users">,
): Promise<Doc<"users">> {
  const user = await ctx.db.get(userId);
  if (user === null || user.organizationId !== organizationId || !user.role)
    throw appError("NOT_FOUND");
  return user;
}

/**
 * The properties for a role: none for admins (they have all), at least one
 * active property of the organisation for everyone else. Returns them sorted
 * and without repeats.
 */
async function checkAssignment(
  ctx: Db,
  organizationId: Id<"organizations">,
  role: Role,
  propertyIds: Id<"properties">[],
): Promise<Id<"properties">[]> {
  if (role === "admin") return [];
  const valid = new Set<string>(
    (await organizationProperties(ctx, organizationId)).map((p) => p._id),
  );
  const unique = [...new Set(propertyIds)];
  if (unique.length === 0)
    throw appError("INVALID_INPUT", "Choose at least one property.");
  if (unique.some((id) => !valid.has(id)))
    throw appError("INVALID_INPUT", "One of those properties wasn't found.");
  return unique.sort();
}

/** Signs an account out everywhere, at once (mutations can't call invalidateSessions). */
async function endSessions(ctx: Pick<MutationCtx, "db">, userId: Id<"users">) {
  const sessions = await ctx.db
    .query("authSessions")
    .withIndex("userId", (q) => q.eq("userId", userId))
    .collect();
  for (const session of sessions) {
    const tokens = await ctx.db
      .query("authRefreshTokens")
      .withIndex("sessionIdAndParentRefreshTokenId", (q) =>
        q.eq("sessionId", session._id),
      )
      .collect();
    for (const token of tokens) await ctx.db.delete(token._id);
    await ctx.db.delete(session._id);
  }
}

/** Everyone with an account: you first, then admins, then by name. */
export const list = adminQuery({
  args: {},
  handler: async (ctx) => {
    const users = await organizationUsers(ctx, ctx.admin.organization._id);
    const names = new Map<string, string>(
      ctx.admin.properties.map((p) => [p._id, p.name]),
    );
    const rank = (u: Doc<"users">) =>
      u._id === ctx.admin.userId ? 0 : u.role === "admin" ? 1 : 2;
    return users
      .filter((u) => u.role !== undefined)
      .sort(
        (a, b) =>
          Number(a.disabled === true) - Number(b.disabled === true) ||
          rank(a) - rank(b) ||
          (a.name ?? "").localeCompare(b.name ?? ""),
      )
      .map((u) => ({
        userId: u._id,
        name: u.name ?? "",
        phone: u.phone ?? "",
        role: u.role!,
        propertyIds: u.role === "admin" ? [] : (u.propertyIds ?? []),
        propertyNames:
          u.role === "admin"
            ? []
            : (u.propertyIds ?? [])
                .map((id) => names.get(id))
                .filter((n): n is string => n !== undefined)
                .sort((a, b) => a.localeCompare(b)),
        disabled: u.disabled === true,
        mustChangePassword: u.mustChangePassword === true,
        ssoManaged: u.ssoManaged === true,
        isYou: u._id === ctx.admin.userId,
      }));
  },
});

/**
 * Creates an account with the temporary password the admin chose (they must
 * change it at first sign-in).
 */
export const create = adminAction({
  args: {
    name: v.string(),
    phone: v.string(),
    role: vRole,
    assignedPropertyIds: v.array(v.id("properties")),
    temporaryPassword: v.string(),
  },
  handler: async (ctx, args): Promise<{ userId: Id<"users"> }> => {
    const phone = normalizePhone(args.phone);
    if (phone === null) throw appError("INVALID_PHONE");
    const name = displayNameSchema.safeParse(args.name);
    if (!name.success)
      throw appError("INVALID_INPUT", name.error.issues[0]?.message);
    const problem = passwordProblem(args.temporaryPassword, phone);
    if (problem !== null) throw appError("WEAK_PASSWORD", problem);
    // Checks the number and the properties before making a login.
    await ctx.runQuery(internal.accounts.checkNewAccount, {
      phone,
      organizationId: ctx.admin.organizationId,
      role: args.role,
      assignedPropertyIds: args.assignedPropertyIds,
    });
    let userId: Id<"users">;
    try {
      userId = await createLogin(ctx, phone, args.temporaryPassword);
    } catch {
      throw appError("CONFLICT", "That mobile number already has an account.");
    }
    try {
      await ctx.runMutation(internal.accounts.setUpAccount, {
        userId,
        name: name.data,
        role: args.role,
        assignedPropertyIds: args.assignedPropertyIds,
        organizationId: ctx.admin.organizationId,
        actorUserId: ctx.admin.userId,
      });
    } catch (error) {
      await ctx.runMutation(internal.accounts.removeLogin, { userId });
      throw error;
    }
    return { userId };
  },
});

export const checkNewAccount = internalQuery({
  args: {
    phone: v.string(),
    organizationId: v.id("organizations"),
    role: vRole,
    assignedPropertyIds: v.array(v.id("properties")),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("phone", (q) => q.eq("phone", args.phone))
      .first();
    if (existing !== null)
      throw appError("CONFLICT", "That mobile number already has an account.");
    await checkAssignment(
      ctx,
      args.organizationId,
      args.role,
      args.assignedPropertyIds,
    );
    return null;
  },
});

export const setUpAccount = internalMutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    role: vRole,
    assignedPropertyIds: v.array(v.id("properties")),
    organizationId: v.id("organizations"),
    actorUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const propertyIds = await checkAssignment(
      ctx,
      args.organizationId,
      args.role,
      args.assignedPropertyIds,
    );
    await ctx.db.patch(args.userId, {
      name: args.name,
      role: args.role,
      organizationId: args.organizationId,
      propertyIds: args.role === "admin" ? undefined : propertyIds,
      mustChangePassword: true,
    });
    const user = (await ctx.db.get(args.userId))!;
    await writeAudit(ctx, {
      organizationId: args.organizationId,
      actorUserId: args.actorUserId,
      action: "account.created",
      entityType: "users",
      entityId: args.userId,
      metadata: {
        after: {
          name: args.name,
          phone: user.phone,
          role: args.role,
          propertyIds,
        },
      },
    });
    return null;
  },
});

/** Undoes a half-made login (internal: only when setting it up failed). */
export const removeLogin = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    for (const account of await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
      .collect()) {
      await ctx.db.delete(account._id);
    }
    const user = await ctx.db.get(userId);
    if (user !== null && user.role === undefined) await ctx.db.delete(userId);
    return null;
  },
});

/** Changes name, role and assigned properties. */
export const update = adminMutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    role: vRole,
    assignedPropertyIds: v.array(v.id("properties")),
  },
  handler: async (ctx, args) => {
    const organizationId = ctx.admin.organization._id;
    const user = await loadAccount(ctx, organizationId, args.userId);
    const name = displayNameSchema.safeParse(args.name);
    if (!name.success)
      throw appError("INVALID_INPUT", name.error.issues[0]?.message);
    if (args.userId === ctx.admin.userId && args.role !== user.role)
      throw appError("CONFLICT", "You can't change your own role.");
    if (
      user.role === "admin" &&
      args.role !== "admin" &&
      user.disabled !== true &&
      (await activeAdminCount(ctx, organizationId)) <= 1
    )
      throw appError("CONFLICT", "There must always be at least one admin.");
    const propertyIds = await checkAssignment(
      ctx,
      organizationId,
      args.role,
      args.assignedPropertyIds,
    );
    const before = {
      name: user.name,
      role: user.role,
      propertyIds: user.role === "admin" ? [] : (user.propertyIds ?? []),
    };
    const after = { name: name.data, role: args.role, propertyIds };
    if (JSON.stringify(before) === JSON.stringify(after)) return null;
    await ctx.db.patch(user._id, {
      name: name.data,
      role: args.role,
      propertyIds: args.role === "admin" ? undefined : propertyIds,
      // An admin's own choice of role replaces anything the Admin Hub remembered.
      roleBeforeSso: undefined,
    });
    await writeAudit(ctx, {
      organizationId,
      actorUserId: ctx.admin.userId,
      action: "account.updated",
      entityType: "users",
      entityId: user._id,
      metadata: { before, after },
    });
    return null;
  },
});

/** Switches an account off (signed out at once) or back on. */
export const setDisabled = adminMutation({
  args: { userId: v.id("users"), disabled: v.boolean() },
  handler: async (ctx, args) => {
    const organizationId = ctx.admin.organization._id;
    const user = await loadAccount(ctx, organizationId, args.userId);
    if (args.userId === ctx.admin.userId)
      throw appError("CONFLICT", "You can't switch off your own account.");
    if ((user.disabled === true) === args.disabled) return null;
    if (
      args.disabled &&
      user.role === "admin" &&
      (await activeAdminCount(ctx, organizationId)) <= 1
    )
      throw appError("CONFLICT", "There must always be at least one admin.");
    await ctx.db.patch(user._id, { disabled: args.disabled });
    if (args.disabled) await endSessions(ctx, user._id);
    await writeAudit(ctx, {
      organizationId,
      actorUserId: ctx.admin.userId,
      action: args.disabled ? "account.deactivated" : "account.reactivated",
      entityType: "users",
      entityId: user._id,
      metadata: { name: user.name, phone: user.phone },
    });
    return null;
  },
});

/** Gives someone a new temporary password (shown once) and signs them out everywhere. */
export const resetPassword = adminAction({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<{ temporaryPassword: string }> => {
    if (userId === ctx.admin.userId)
      throw appError("CONFLICT", "Use Change my password for your own account.");
    const target = await ctx.runQuery(internal.accounts.resetTarget, {
      userId,
      organizationId: ctx.admin.organizationId,
    });
    const password = temporaryPassword();
    await modifyAccountCredentials(ctx, {
      provider: PHONE_PASSWORD_PROVIDER,
      account: { id: target.phone, secret: password },
    });
    await invalidateSessions(ctx, { userId });
    await ctx.runMutation(internal.accounts.recordReset, {
      userId,
      organizationId: ctx.admin.organizationId,
      actorUserId: ctx.admin.userId,
    });
    return { temporaryPassword: password };
  },
});

export const resetTarget = internalQuery({
  args: { userId: v.id("users"), organizationId: v.id("organizations") },
  returns: v.object({ phone: v.string() }),
  handler: async (ctx, { userId, organizationId }) => {
    const user = await loadAccount(ctx, organizationId, userId);
    if (!user.phone) throw appError("NOT_FOUND");
    return { phone: user.phone };
  },
});

export const recordReset = internalMutation({
  args: {
    userId: v.id("users"),
    organizationId: v.id("organizations"),
    actorUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { mustChangePassword: true });
    await writeAudit(ctx, {
      organizationId: args.organizationId,
      actorUserId: args.actorUserId,
      action: "account.password_reset",
      entityType: "users",
      entityId: args.userId,
    });
    return null;
  },
});
