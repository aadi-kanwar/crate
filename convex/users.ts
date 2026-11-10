import {
  getAuthSessionId,
  invalidateSessions,
  modifyAccountCredentials,
  retrieveAccount,
} from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { PHONE_PASSWORD_PROVIDER } from "./auth";
import { writeAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import {
  adminOrganization,
  internalMutation,
  organizationProperties,
  signedInAction,
  viewerQuery,
} from "./lib/functions";
import { passwordProblem } from "./lib/inputRules";

/**
 * What the app needs to decide which screen to show. Returns null when
 * signed out. Only ever describes the caller.
 */
export const me = viewerQuery({
  args: {},
  handler: async (ctx) => {
    if (ctx.viewer === null) return null;
    const { user } = ctx.viewer;
    const organization = user.role ? await adminOrganization(ctx, user) : null;
    const all = organization
      ? await organizationProperties(ctx, organization._id)
      : [];
    const assigned = new Set<string>(user.propertyIds ?? []);
    const properties =
      user.role === "admin" ? all : all.filter((p) => assigned.has(p._id));
    return {
      name: user.name ?? null,
      /** The Admin Hub's address, only for master admins who came from the hub (null for everyone else). */
      hubLink: user.ssoManaged === true ? (process.env.HUB_ORIGIN ?? null) : null,
      /**
       * The organisation and the properties this account works with: all of
       * them for admins, the assigned ones for everyone else. Null for an
       * admin who hasn't set the organisation up yet.
       */
      organization: organization && {
        name: organization.name,
        properties: properties.map((p) => ({
          propertyId: p._id,
          name: p.name,
        })),
      },
      phone: user.phone ?? null,
      role: user.role ?? null,
      mustChangePassword: user.mustChangePassword === true,
    };
  },
});

/**
 * Sets a new password. Needs the current one, except right after an admin
 * created the account or reset it (the temporary password was just used to
 * sign in). Signs out the person's other devices.
 */
export const changePassword = signedInAction({
  args: { currentPassword: v.optional(v.string()), newPassword: v.string() },
  handler: async (ctx, args) => {
    const { userId, phone, mustChangePassword } = ctx.viewer;
    if (!phone)
      throw appError("INVALID_INPUT", "Your account has no mobile number.");
    if (!mustChangePassword) {
      try {
        await retrieveAccount(ctx, {
          provider: PHONE_PASSWORD_PROVIDER,
          account: { id: phone, secret: args.currentPassword ?? "" },
        });
      } catch {
        throw appError("INVALID_INPUT", "Your current password isn't right.");
      }
    }
    const problem = passwordProblem(args.newPassword, phone);
    if (problem !== null) throw appError("WEAK_PASSWORD", problem);
    if (args.newPassword === args.currentPassword) {
      throw appError(
        "WEAK_PASSWORD",
        "Choose a password different from the current one.",
      );
    }
    await modifyAccountCredentials(ctx, {
      provider: PHONE_PASSWORD_PROVIDER,
      account: { id: phone, secret: args.newPassword },
    });
    const sessionId = await getAuthSessionId(ctx);
    await invalidateSessions(ctx, {
      userId,
      except: sessionId ? [sessionId] : [],
    });
    await ctx.runMutation(internal.users.recordPasswordChanged, { userId });
    return null;
  },
});

export const recordPasswordChanged = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (user?.mustChangePassword)
      await ctx.db.patch(userId, { mustChangePassword: false });
    await writeAudit(ctx, {
      organizationId: user?.organizationId,
      actorUserId: userId,
      action: "user.password_changed",
      entityType: "users",
      entityId: userId,
    });
    return null;
  },
});
