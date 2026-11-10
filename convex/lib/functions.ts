/**
 * The ONLY place in the backend allowed to use Convex's raw `query`,
 * `mutation`, `action` and internal builders. Every other file builds its
 * functions from the wrappers here, so no function can skip the permission
 * checks. (Enforced by ESLint and by convex/tests/enforcement.test.ts.)
 *
 * Wrappers that browsers can call:
 *   viewerQuery              - signed in or not; ctx.viewer is null when signed out
 *   signedInAction           - any signed-in account (password change)
 *   adminQuery/Mutation      - an admin of an organisation (ctx.admin). Takes an
 *                              optional `propertyId` argument: the property the
 *                              screen shows. ctx.admin.properties is every property
 *                              of their organisation; ctx.admin.property the chosen
 *                              one (or the only one), else null = "all".
 *   adminAction              - the same check for actions (ctx.admin.organizationId)
 *   orgSetupQuery/Mutation   - an admin, with or without an organisation yet
 *                              (ctx.admin.organization may be null). Only for
 *                              creating and showing the organisation itself.
 *   memberQuery/Mutation     - any set-up account of the organisation, for
 *                              purchase entries (ctx.member). Managers and
 *                              kitchen staff reach only their assigned
 *                              properties (ctx.member.properties); admins
 *                              all of them. Check a property with
 *                              requireProperty().
 *
 * Everyone must have changed the temporary password first.
 *
 * Internal wrappers (never callable from a browser; only from other backend
 * functions or the owner via the Convex dashboard / CLI):
 *   internalQuery, internalMutation, internalAction
 *
 * All mutation wrappers make `auditLog` append-only: patch / replace /
 * delete on it throws.
 */
import { getAuthSessionId, getAuthUserId } from "@convex-dev/auth/server";
import { makeFunctionReference } from "convex/server";
import {
  customAction,
  customCtx,
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";
import { wrapDatabaseWriter } from "convex-helpers/server/rowLevelSecurity";
import { v } from "convex/values";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import {
  action as rawAction,
  httpAction as rawHttpAction,
  internalAction as rawInternalAction,
  internalMutation as rawInternalMutation,
  internalQuery as rawInternalQuery,
  mutation as rawMutation,
  query as rawQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { appError } from "./errors";

type ReadCtx = Pick<QueryCtx, "db" | "auth">;

export type SignedInViewer = { userId: Id<"users">; user: Doc<"users"> };

/**
 * The signed-in account, or null. Identity always comes from the session,
 * never from arguments. The session must still exist: a password reset or
 * change deletes other sessions, and their tokens stop working at once.
 */
export async function getViewer(ctx: ReadCtx): Promise<SignedInViewer | null> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  const sessionId = await getAuthSessionId(ctx);
  if (sessionId === null) return null;
  const session = await ctx.db.get(sessionId);
  if (session === null) return null;
  const user = await ctx.db.get(userId);
  if (user === null) return null;
  // Admin Hub logins last 12 hours; end them exactly on time.
  if (user.ssoManaged === true && session.expirationTime < Date.now()) return null;
  return { userId, user };
}

export async function requireUser(ctx: ReadCtx): Promise<SignedInViewer> {
  const viewer = await getViewer(ctx);
  if (viewer === null) throw appError("NOT_SIGNED_IN");
  if (viewer.user.disabled) throw appError("ACCOUNT_DISABLED");
  return viewer;
}

export async function requireAdmin(ctx: ReadCtx): Promise<SignedInViewer> {
  const viewer = await requireUser(ctx);
  if (viewer.user.role !== "admin") throw appError("FORBIDDEN");
  if (viewer.user.mustChangePassword)
    throw appError("PASSWORD_CHANGE_REQUIRED");
  return viewer;
}

export type AdminViewer = SignedInViewer & {
  organization: Doc<"organizations">;
  /** Active properties of the organisation, by name. */
  properties: Doc<"properties">[];
  /** The property the screen is about, or null for "all properties". */
  property: Doc<"properties"> | null;
};

type DbCtx = Pick<QueryCtx, "db">;

/** Active properties of an organisation, by name. */
export async function organizationProperties(
  ctx: DbCtx,
  organizationId: Id<"organizations">,
): Promise<Doc<"properties">[]> {
  const rows = await ctx.db
    .query("properties")
    .withIndex("by_org_status", (q) =>
      q.eq("organizationId", organizationId).eq("status", "active"),
    )
    .collect();
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/** The admin's active organisation, or null if they haven't set one up. */
export async function adminOrganization(
  ctx: DbCtx,
  user: Doc<"users">,
): Promise<Doc<"organizations"> | null> {
  if (user.organizationId === undefined) return null;
  const organization = await ctx.db.get(user.organizationId);
  return organization !== null && organization.status === "active"
    ? organization
    : null;
}

/**
 * An admin with an organisation. `propertyId`, when given, must be one of
 * its properties; with a single property, that one is always chosen.
 */
export async function requireAdminOrg(
  ctx: ReadCtx,
  propertyId?: Id<"properties">,
): Promise<AdminViewer> {
  const viewer = await requireAdmin(ctx);
  const organization = await adminOrganization(ctx, viewer.user);
  if (organization === null) throw appError("ORG_REQUIRED");
  const properties = await organizationProperties(ctx, organization._id);
  let property: Doc<"properties"> | null = null;
  if (propertyId !== undefined) {
    property = properties.find((p) => p._id === propertyId) ?? null;
    if (property === null) throw appError("FORBIDDEN");
  } else if (properties.length === 1) {
    property = properties[0];
  }
  return { ...viewer, organization, properties, property };
}

/** The properties a screen covers: the chosen one, or all of the organisation's. */
export function inScope(
  admin: Pick<AdminViewer, "property" | "properties">,
): Doc<"properties">[] {
  return admin.property ? [admin.property] : admin.properties;
}

/** A property of the admin's organisation (any, not just the chosen one), else NOT_FOUND. */
export function orgProperty(
  admin: Pick<AdminViewer, "properties">,
  propertyId: Id<"properties">,
): Doc<"properties"> {
  const property = admin.properties.find((p) => p._id === propertyId);
  if (!property) throw appError("NOT_FOUND", "That property wasn't found.");
  return property;
}

export type MemberViewer = SignedInViewer & {
  organization: Doc<"organizations">;
  /** Properties this account may enter for: assigned ones (managers, kitchen staff) or all (admins). By name. */
  properties: Doc<"properties">[];
  isAdmin: boolean;
};

/**
 * Any set-up account of the organisation: admins (every property) or
 * managers / kitchen staff (only the active properties assigned to them).
 */
export async function requireMember(ctx: ReadCtx): Promise<MemberViewer> {
  const viewer = await requireUser(ctx);
  const role = viewer.user.role;
  if (role === undefined) throw appError("FORBIDDEN");
  if (viewer.user.mustChangePassword)
    throw appError("PASSWORD_CHANGE_REQUIRED");
  const organization = await adminOrganization(ctx, viewer.user);
  if (organization === null)
    throw appError(role === "admin" ? "ORG_REQUIRED" : "FORBIDDEN");
  const all = await organizationProperties(ctx, organization._id);
  const isAdmin = role === "admin";
  const assigned = new Set<string>(viewer.user.propertyIds ?? []);
  const properties = isAdmin ? all : all.filter((p) => assigned.has(p._id));
  return { ...viewer, organization, properties, isAdmin };
}

/** One of the member's own properties, else FORBIDDEN. */
export function requireProperty(
  member: Pick<MemberViewer, "properties">,
  propertyId: Id<"properties">,
): Doc<"properties"> {
  const property = member.properties.find((p) => p._id === propertyId);
  if (!property) throw appError("FORBIDDEN");
  return property;
}

// ---------------------------------------------------------------------------
// Append-only tables.
// ---------------------------------------------------------------------------

const appendOnlyRules = {
  auditLog: { modify: async () => false },
};

/** Exported for tests; every mutation wrapper below uses it. */
export function guardedDb(ctx: MutationCtx): MutationCtx["db"] {
  return wrapDatabaseWriter<MutationCtx, DataModel>(
    ctx,
    ctx.db,
    appendOnlyRules,
  );
}

// ---------------------------------------------------------------------------
// Public wrappers (callable from the browser).
// ---------------------------------------------------------------------------

export const viewerQuery = customQuery(
  rawQuery,
  customCtx(async (ctx) => ({ viewer: await getViewer(ctx) })),
);

/** Every admin function takes this argument: the property the screen shows (omit for all / the only one). */
const propertyArg = { propertyId: v.optional(v.id("properties")) };

export const adminQuery = customQuery(rawQuery, {
  args: propertyArg,
  input: async (ctx, args) => ({
    ctx: { admin: await requireAdminOrg(ctx, args.propertyId) },
    args: {},
  }),
});

export const adminMutation = customMutation(rawMutation, {
  args: propertyArg,
  input: async (ctx, args) => ({
    ctx: {
      admin: await requireAdminOrg(ctx, args.propertyId),
      db: guardedDb(ctx),
    },
    args: {},
  }),
});

async function requireOrgSetupAdmin(ctx: ReadCtx) {
  const viewer = await requireAdmin(ctx);
  return { ...viewer, organization: await adminOrganization(ctx, viewer.user) };
}

export const orgSetupQuery = customQuery(
  rawQuery,
  customCtx(async (ctx) => ({ admin: await requireOrgSetupAdmin(ctx) })),
);

export const orgSetupMutation = customMutation(
  rawMutation,
  customCtx(async (ctx) => ({
    admin: await requireOrgSetupAdmin(ctx),
    db: guardedDb(ctx),
  })),
);

/** Purchase entries: see requireMember. */
export const memberQuery = customQuery(
  rawQuery,
  customCtx(async (ctx) => ({ member: await requireMember(ctx) })),
);

export const memberMutation = customMutation(
  rawMutation,
  customCtx(async (ctx) => ({
    member: await requireMember(ctx),
    db: guardedDb(ctx),
  })),
);

// Actions have no database access, so they check the caller through these
// internal queries (convex/access.ts), which run the same helpers as above.

export type ActionViewer = {
  userId: Id<"users">;
  phone: string;
  mustChangePassword: boolean;
};
export type ActionAdmin = {
  userId: Id<"users">;
  organizationId: Id<"organizations">;
};

const viewerForAction = makeFunctionReference<
  "query",
  Record<string, never>,
  ActionViewer
>("access:viewerForAction");
const adminForAction = makeFunctionReference<
  "query",
  Record<string, never>,
  ActionAdmin
>("access:adminForAction");

export const signedInAction = customAction(
  rawAction,
  customCtx(async (ctx) => ({
    viewer: await ctx.runQuery(viewerForAction, {}),
  })),
);

export const adminAction = customAction(
  rawAction,
  customCtx(async (ctx) => ({ admin: await ctx.runQuery(adminForAction, {}) })),
);

// ---------------------------------------------------------------------------
// Internal wrappers (never callable from the browser).
// ---------------------------------------------------------------------------

export const internalQuery = rawInternalQuery;

export const internalMutation = customMutation(
  rawInternalMutation,
  customCtx(async (ctx) => ({ db: guardedDb(ctx) })),
);

export const internalAction = rawInternalAction;

/**
 * Web endpoints (convex/http.ts). They have no login, so each one must check
 * who is calling before doing anything: the only one, the Admin Hub's
 * "Revoke in all apps", accepts only a request signed by the hub.
 */
export const hubSignedHttpAction = rawHttpAction;
