import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { convexAuth, retrieveAccount } from "@convex-dev/auth/server";
import { Scrypt } from "lucia";
import { internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { FAILED_ATTEMPTS_LIMIT } from "./authLimits";
import { appError } from "./lib/errors";
import { normalizePhone } from "./lib/inputRules";

export const PHONE_PASSWORD_PROVIDER = "phone-password";

/** Password hashing shared by sign-in and by the admin when creating accounts. */
export const passwordCrypto = {
  async hashSecret(password: string) {
    return await new Scrypt().hash(password);
  },
  async verifySecret(password: string, hash: string) {
    return await new Scrypt().verify(hash, password);
  },
};

/**
 * Mobile number + password login. There is NO sign-up: accounts are created
 * by an admin (convex/accounts.ts) or by the first-admin script
 * (convex/setup.ts). The identifier is the number in E.164 form (default
 * country India, +91). Every failure returns the same SIGN_IN_FAILED message
 * so it never reveals whether a number has an account.
 *
 * The browser calls `signIn("phone-password", { phone, password })`.
 */
const PhonePassword = ConvexCredentials<DataModel>({
  id: PHONE_PASSWORD_PROVIDER,
  authorize: async (params, ctx) => {
    const phone = typeof params.phone === "string" ? normalizePhone(params.phone) : null;
    if (phone === null) throw appError("INVALID_PHONE");
    const password = typeof params.password === "string" ? params.password : "";
    if (params.flow !== undefined && params.flow !== "signIn") throw appError("FORBIDDEN");

    const gate = await ctx.runMutation(internal.authLimits.checkAttempt, { phone });
    if (!gate.allowed) throw appError("TOO_MANY_ATTEMPTS");
    return await signInExisting(ctx, phone, password);
  },
  crypto: passwordCrypto,
});

async function signInExisting(ctx: ActionCtx, phone: string, password: string) {
  if (password.length === 0) throw appError("SIGN_IN_FAILED");
  let userId;
  try {
    const { user } = await retrieveAccount(ctx, {
      provider: PHONE_PASSWORD_PROVIDER,
      account: { id: phone, secret: password },
    });
    userId = user._id;
  } catch (error) {
    if (error instanceof Error && error.message === "TooManyFailedAttempts") {
      throw appError("TOO_MANY_ATTEMPTS");
    }
    await ctx.runMutation(internal.authLimits.recordFailure, { phone });
    throw appError("SIGN_IN_FAILED");
  }
  const allowed = await ctx.runQuery(internal.access.canSignIn, { userId });
  if (!allowed) {
    await ctx.runMutation(internal.authLimits.recordFailure, { phone });
    throw appError("SIGN_IN_FAILED");
  }
  await ctx.runMutation(internal.authLimits.clearFailures, { phone });
  return { userId };
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [PhonePassword],
  signIn: {
    // Convex Auth's own per-account limit, kept above ours so ours applies first.
    maxFailedAttempsPerHour: FAILED_ATTEMPTS_LIMIT * 4 + 10,
  },
});
