import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import { hubSignedHttpAction } from "./lib/functions";
import { bearerToken } from "./lib/ssoTicket";

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

/**
 * Livoza Hub sync: one person or property, in a token the hub signed for
 * audience "crate-sync". The app is made to match it. 401 for anything else.
 */
http.route({
  path: "/sso/sync",
  method: "POST",
  handler: hubSignedHttpAction(async (ctx, request) => {
    const token = bearerToken(request);
    const sync = token ? await ctx.runAction(internal.ssoNode.verifySync, { token }) : null;
    if (sync === null) return Response.json({ ok: false }, { status: 401 });
    const applied =
      sync.kind === "person"
        ? await ctx.runMutation(internal.sso.applySync, {
            jti: sync.jti,
            person: {
              hubUserId: sync.hubUserId,
              phone: sync.phone,
              name: sync.name,
              profileType: sync.profileType,
              role: sync.role,
              properties: sync.properties,
              roomNumber: sync.roomNumber,
              active: sync.active,
              revoke: sync.revoke,
            },
          })
        : await ctx.runMutation(internal.sso.applySync, {
            jti: sync.jti,
            property: {
              id: sync.property.id,
              name: sync.property.name,
              organizationName: sync.property.organizationName,
              toolPropertyId: sync.toolPropertyId,
            },
          });
    if (!applied) return Response.json({ ok: false }, { status: 401 });
    return Response.json({ ok: true });
  }),
});

/**
 * Livoza Hub import: everyone and every property in this app, for a token
 * the hub signed for audience "crate-export". 401 for anything else.
 */
http.route({
  path: "/sso/export",
  method: "POST",
  handler: hubSignedHttpAction(async (ctx, request) => {
    const token = bearerToken(request);
    const checked = token ? await ctx.runAction(internal.ssoNode.verifyExport, { token }) : null;
    const data = checked ? await ctx.runMutation(internal.sso.exportForImport, checked) : null;
    if (data === null) return Response.json({ ok: false }, { status: 401 });
    return Response.json({ ok: true, ...data });
  }),
});

export default http;
