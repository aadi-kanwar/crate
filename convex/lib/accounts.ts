import { createAccount } from "@convex-dev/auth/server";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { PHONE_PASSWORD_PROVIDER } from "../auth";

/** Creates a phone + password login (actions only). The users row gets its role afterwards. */
export async function createLogin(ctx: ActionCtx, phone: string, password: string): Promise<Id<"users">> {
  const { user } = await createAccount(ctx, {
    provider: PHONE_PASSWORD_PROVIDER,
    account: { id: phone, secret: password },
    profile: { phone },
  });
  return user._id;
}

export { temporaryPassword } from "./inputRules";
