"use node";

import { v } from "convex/values";
import { internalAction } from "./lib/functions";
import { hubTicketSettingsFromEnv, verifyHubRevoke, verifyHubTicket } from "./lib/ssoTicket";

/**
 * Checks an Admin Hub ticket's signature (Node.js, for its built-in Ed25519
 * support). Returns the ticket's details, or null for any problem.
 * Internal: only the `hub-sso` login provider calls it.
 */
export const verifyTicket = internalAction({
  args: { ticket: v.string() },
  returns: v.union(
    v.null(),
    v.object({ jti: v.string(), hubAdminId: v.string(), phone: v.string(), name: v.string() }),
  ),
  handler: async (_ctx, { ticket }) => await verifyHubTicket(ticket, hubTicketSettingsFromEnv()),
});

/** Checks a "Revoke in all apps" request from the hub. Returns its details, or null. */
export const verifyRevoke = internalAction({
  args: { token: v.string() },
  returns: v.union(v.null(), v.object({ jti: v.string(), phone: v.string() })),
  handler: async (_ctx, { token }) => await verifyHubRevoke(token, hubTicketSettingsFromEnv()),
});
