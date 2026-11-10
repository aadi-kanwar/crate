import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./lib/functions";

/**
 * Sign-in abuse protection (internal only; called by the login provider).
 *
 * - Failed attempts are counted per phone number, whether or not the number
 *   is registered, so the limit itself never reveals who has an account.
 *
 * Convex Auth also has its own per-account limit; ours is set stricter
 * (see convex/auth.ts) so ours is always the one people run into.
 */
export const FAILED_ATTEMPTS_LIMIT = 5;
export const FAILED_ATTEMPTS_WINDOW_MS = 15 * 60 * 1000;

const failKey = (phone: string) => `fail:${phone}`;

async function currentCount(ctx: MutationCtx, key: string, windowMs: number, now: number) {
  const row = await ctx.db
    .query("authAttemptLimits")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (row === null || now - row.windowStart >= windowMs) return { row, count: 0 };
  return { row, count: row.count };
}

async function increment(ctx: MutationCtx, key: string, windowMs: number, now: number) {
  const { row, count } = await currentCount(ctx, key, windowMs, now);
  if (row === null) {
    await ctx.db.insert("authAttemptLimits", { key, windowStart: now, count: 1 });
  } else if (count === 0) {
    await ctx.db.patch(row._id, { windowStart: now, count: 1 });
  } else {
    await ctx.db.patch(row._id, { count: count + 1 });
  }
}

export const checkAttempt = internalMutation({
  args: { phone: v.string() },
  returns: v.object({ allowed: v.boolean() }),
  handler: async (ctx, { phone }) => {
    const failures = await currentCount(ctx, failKey(phone), FAILED_ATTEMPTS_WINDOW_MS, Date.now());
    return { allowed: failures.count < FAILED_ATTEMPTS_LIMIT };
  },
});

export const recordFailure = internalMutation({
  args: { phone: v.string() },
  returns: v.null(),
  handler: async (ctx, { phone }) => {
    await increment(ctx, failKey(phone), FAILED_ATTEMPTS_WINDOW_MS, Date.now());
    return null;
  },
});

export const clearFailures = internalMutation({
  args: { phone: v.string() },
  returns: v.null(),
  handler: async (ctx, { phone }) => {
    const row = await ctx.db
      .query("authAttemptLimits")
      .withIndex("by_key", (q) => q.eq("key", failKey(phone)))
      .unique();
    if (row !== null) await ctx.db.delete(row._id);
    return null;
  },
});
