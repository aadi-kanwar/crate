import { v } from "convex/values";
import { internalQuery, requireAdminOrg, requireUser } from "./lib/functions";

/**
 * Permission checks for actions (signedInAction / adminAction in
 * lib/functions.ts) and for the login provider. Internal: never callable
 * from a browser. They run with the caller's own login.
 */

export const viewerForAction = internalQuery({
  args: {},
  returns: v.object({
    userId: v.id("users"),
    phone: v.string(),
    mustChangePassword: v.boolean(),
  }),
  handler: async (ctx) => {
    const { userId, user } = await requireUser(ctx);
    return {
      userId,
      phone: user.phone ?? "",
      mustChangePassword: user.mustChangePassword === true,
    };
  },
});

export const adminForAction = internalQuery({
  args: {},
  returns: v.object({
    userId: v.id("users"),
    organizationId: v.id("organizations"),
  }),
  handler: async (ctx) => {
    const { userId, organization } = await requireAdminOrg(ctx);
    return { userId, organizationId: organization._id };
  },
});

/** Only set-up, enabled accounts may sign in. */
export const canSignIn = internalQuery({
  args: { userId: v.id("users") },
  returns: v.boolean(),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    return user !== null && user.role !== undefined && user.disabled !== true;
  },
});
