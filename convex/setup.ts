/**
 * One-time setup. INTERNAL: browsers can never call it. Run from the CLI:
 *
 *   npx convex run setup:createFirstAdmin '{"phone":"98765 43210","password":"…","name":"Your name"}'
 *
 * or set SEED_ADMIN_PHONE, SEED_ADMIN_PASSWORD and SEED_ADMIN_NAME on the
 * Convex deployment and run `npx convex run setup:createFirstAdmin`.
 * Refuses to run once any admin exists, so it can't be used to take over.
 * The admin then names the organisation and its first property in the app.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { createLogin } from "./lib/accounts";
import { writeAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./lib/functions";
import {
  displayNameSchema,
  normalizePhone,
  passwordProblem,
} from "./lib/inputRules";

export const createFirstAdmin = internalAction({
  args: {
    phone: v.optional(v.string()),
    password: v.optional(v.string()),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ message: string }> => {
    const phone = normalizePhone(
      args.phone ?? process.env.SEED_ADMIN_PHONE ?? "",
    );
    if (phone === null)
      throw appError(
        "INVALID_PHONE",
        "Give a valid mobile number (phone, or SEED_ADMIN_PHONE).",
      );
    const password = args.password ?? process.env.SEED_ADMIN_PASSWORD ?? "";
    const problem = passwordProblem(password, phone);
    if (problem !== null) throw appError("WEAK_PASSWORD", problem);
    const name = displayNameSchema.safeParse(
      args.name ?? process.env.SEED_ADMIN_NAME ?? "Admin",
    );
    if (!name.success)
      throw appError("INVALID_INPUT", name.error.issues[0]?.message);
    if (await ctx.runQuery(internal.setup.adminExists, {})) {
      throw appError(
        "CONFLICT",
        "An admin already exists. This step only works once.",
      );
    }
    const userId = await createLogin(ctx, phone, password);
    await ctx.runMutation(internal.setup.makeAdmin, {
      userId,
      name: name.data,
    });
    return {
      message: `${name.data} (${phone}) is now the admin. Sign in with that number and password.`,
    };
  },
});

export const adminExists = internalQuery({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) =>
    (await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "admin"))
      .first()) !== null,
});

export const makeAdmin = internalMutation({
  args: { userId: v.id("users"), name: v.string() },
  handler: async (ctx, { userId, name }) => {
    await ctx.db.patch(userId, {
      role: "admin",
      name,
      mustChangePassword: false,
    });
    await writeAudit(ctx, {
      organizationId: undefined,
      actorUserId: undefined,
      action: "setup.first_admin_created",
      entityType: "users",
      entityId: userId,
    });
    return null;
  },
});
