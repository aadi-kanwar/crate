/**
 * Admin: the organisation and its properties (as in the Staff app and
 * MealSync). Crate runs ONE organisation: the first admin names it, with its
 * first property, at their first sign-in; that also creates the starting
 * categories. Properties are then added and renamed in Settings. Managers and
 * kitchen staff are assigned to one or more properties (convex/accounts.ts).
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import {
  adminMutation,
  adminQuery,
  orgProperty,
  orgSetupMutation,
  orgSetupQuery,
} from "./lib/functions";

export const MAX_NAME_LENGTH = 60;

/** The categories a new organisation starts with, in this order. */
export const STARTING_CATEGORIES = [
  "Grocery",
  "Fruits & Vegetables",
  "Dairy",
  "Kitchen Supplies",
  "Utility (LPG)",
] as const;
/** Upper bound on properties per organisation, to keep every screen fast. */
export const MAX_PROPERTIES = 50;

/** A tidy organisation or property name (spaces collapsed), or INVALID_INPUT. */
export function checkName(raw: string, what: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 2)
    throw appError("INVALID_INPUT", `${what} needs at least 2 characters.`);
  if (name.length > MAX_NAME_LENGTH)
    throw appError(
      "INVALID_INPUT",
      `${what} can be at most ${MAX_NAME_LENGTH} characters.`,
    );
  return name;
}

async function insertProperty(
  ctx: Pick<MutationCtx, "db">,
  organizationId: Id<"organizations">,
  existing: Doc<"properties">[],
  rawName: string,
  actorUserId: Id<"users">,
): Promise<Id<"properties">> {
  const name = checkName(rawName, "The property name");
  if (existing.length >= MAX_PROPERTIES)
    throw appError(
      "INVALID_INPUT",
      `An organisation can have at most ${MAX_PROPERTIES} properties.`,
    );
  if (existing.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    throw appError("CONFLICT", "There's already a property with that name.");
  }
  const propertyId = await ctx.db.insert("properties", {
    organizationId,
    name,
    status: "active",
    createdAt: Date.now(),
  });
  await writeAudit(ctx, {
    organizationId,
    actorUserId,
    action: "property.added",
    entityType: "properties",
    entityId: propertyId,
    metadata: { name },
  });
  return propertyId;
}

/** Whether the admin has set up their organisation yet (shown before everything else). */
export const status = orgSetupQuery({
  args: {},
  handler: async (ctx) => ({
    hasOrganization: ctx.admin.organization !== null,
  }),
});

/** Creates THE organisation with its first property and the starting categories. Works once. */
export const create = orgSetupMutation({
  args: { name: v.string(), propertyName: v.string() },
  handler: async (ctx, args) => {
    if (ctx.admin.organization !== null)
      throw appError("CONFLICT", "You already have an organisation.");
    if ((await ctx.db.query("organizations").first()) !== null)
      throw appError(
        "CONFLICT",
        "The organisation is already set up. Ask its admin to add you.",
      );
    const name = checkName(args.name, "The organisation name");
    const { userId } = ctx.admin;
    const organizationId = await ctx.db.insert("organizations", {
      name,
      status: "active",
      createdBy: userId,
      createdAt: Date.now(),
    });
    await ctx.db.patch(userId, { organizationId });
    await writeAudit(ctx, {
      organizationId,
      actorUserId: userId,
      action: "organization.created",
      entityType: "organizations",
      entityId: organizationId,
      metadata: { name },
    });
    for (const [index, categoryName] of STARTING_CATEGORIES.entries()) {
      await ctx.db.insert("categories", {
        organizationId,
        name: categoryName,
        sortOrder: index,
        archived: false,
        createdAt: Date.now(),
      });
    }
    const propertyId = await insertProperty(
      ctx,
      organizationId,
      [],
      args.propertyName,
      userId,
    );
    return { organizationId, propertyId };
  },
});

/** The organisation and its properties, with how many active people are assigned to each. */
export const get = adminQuery({
  args: {},
  handler: async (ctx) => {
    const { organization, properties } = ctx.admin;
    const users = await ctx.db
      .query("users")
      .withIndex("by_org_role", (q) => q.eq("organizationId", organization._id))
      .collect();
    const active = users.filter((u) => u.disabled !== true && u.role !== "admin");
    return {
      name: organization.name,
      properties: properties.map((p) => ({
        propertyId: p._id,
        name: p.name,
        assignedPeople: active.filter((u) => (u.propertyIds ?? []).includes(p._id)).length,
      })),
    };
  },
});

export const rename = adminMutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const name = checkName(args.name, "The organisation name");
    const { organization, userId } = ctx.admin;
    if (name === organization.name) return null;
    await ctx.db.patch(organization._id, { name });
    await writeAudit(ctx, {
      organizationId: organization._id,
      actorUserId: userId,
      action: "organization.renamed",
      entityType: "organizations",
      entityId: organization._id,
      metadata: { before: organization.name, after: name },
    });
    return null;
  },
});

export const addProperty = adminMutation({
  args: { name: v.string() },
  handler: async (ctx, args) =>
    await insertProperty(
      ctx,
      ctx.admin.organization._id,
      ctx.admin.properties,
      args.name,
      ctx.admin.userId,
    ),
});

export const renameProperty = adminMutation({
  args: { targetPropertyId: v.id("properties"), name: v.string() },
  handler: async (ctx, args) => {
    const property = orgProperty(ctx.admin, args.targetPropertyId);
    const name = checkName(args.name, "The property name");
    if (name === property.name) return null;
    if (
      ctx.admin.properties.some(
        (p) =>
          p._id !== property._id && p.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      throw appError("CONFLICT", "There's already a property with that name.");
    }
    await ctx.db.patch(property._id, { name });
    await writeAudit(ctx, {
      organizationId: property.organizationId,
      actorUserId: ctx.admin.userId,
      action: "property.renamed",
      entityType: "properties",
      entityId: property._id,
      metadata: { before: property.name, after: name },
    });
    return null;
  },
});
