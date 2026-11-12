import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import { hubSignedHttpAction } from "./lib/functions";

const http = httpRouter();

// Login endpoints used by Convex Auth.
auth.addHttpRoutes(http);

/**
 * Admin Hub "Revoke in all apps". The hub sends
 * `Authorization: Bearer <token>`, a one-time token it signed for
 * audience "crate-revoke". Anything else gets 401 and changes nothing.
 */
http.route({
  path: "/sso/revoke",
  method: "POST",
  handler: hubSignedHttpAction(async (ctx, request) => {
    const header = request.headers.get("Authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
    const revoke = token ? await ctx.runAction(internal.ssoNode.verifyRevoke, { token }) : null;
    const result = revoke ? await ctx.runMutation(internal.sso.revokeAccess, revoke) : null;
    if (result === null) return Response.json({ ok: false }, { status: 401 });
    return Response.json({ ok: true, ...result });
  }),
});

export default http;
