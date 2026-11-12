import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  vBaseUnit,
  vMemberRole,
  vPackSize,
  vRecordStatus,
  vRole,
  vShopType,
  vVerification,
} from "./lib/validators";

/**
 * Crate: kitchen purchases, usage and price history.
 *
 * Organisation → properties exactly as in the Staff app (and MealSync). Crate
 * runs a single organisation. Admins see every property of it; managers and
 * kitchen staff only the properties listed in their `propertyIds`.
 *
 * Money is integer paise. Quantities are numbers in the item's base unit.
 * Times are milliseconds; dates are shown in Asia/Kolkata.
 *
 * "Scope" of an entry: one property, or "shared" (bought for the whole
 * organisation). `scopeKey` is the property's id, or "shared", so one index
 * serves both.
 *
 * Convex has no unique constraints: every "one per X" rule is enforced in the
 * mutation that inserts the row.
 */
export default defineSchema({
  ...authTables,

  // Admin Hub sign-in tickets already used (by their one-time `jti`), so a
  // ticket can't be used twice. Rows older than 10 minutes are deleted.
  ssoUsedTickets: defineTable({
    jti: v.string(), // unique
    usedAt: v.number(),
  })
    .index("by_jti", ["jti"])
    .index("by_usedAt", ["usedAt"]),

  organizations: defineTable({
    name: v.string(),
    status: vRecordStatus,
    createdBy: v.optional(v.id("users")),
    createdAt: v.number(),
  }),

  properties: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(), // unique within the organisation (case-insensitive)
    status: vRecordStatus,
    createdAt: v.number(),
  }).index("by_org_status", ["organizationId", "status"]),

  // Convex Auth's users table, plus who the account belongs to.
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()), // E.164: the login identifier
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    // Absent until the account is set up by an admin (or the first-admin step).
    role: v.optional(vRole),
    /** The organisation the account belongs to. Absent for the first admin until they set it up. */
    organizationId: v.optional(v.id("organizations")),
    /** Managers and kitchen staff: the properties they may enter for. Ignored for admins (they have all). */
    propertyIds: v.optional(v.array(v.id("properties"))),
    /** Set when an admin created the account or reset its password. */
    mustChangePassword: v.optional(v.boolean()),
    disabled: v.optional(v.boolean()),
    /** True once a master admin has signed in through the Admin Hub (single sign-on). */
    ssoManaged: v.optional(v.boolean()),
    /** A manager/kitchen staff made admin by an Admin Hub sign-in: their role before, restored on revoke. */
    roleBeforeSso: v.optional(vMemberRole),
  })
    .index("email", ["email"])
    .index("phone", ["phone"])
    .index("by_role", ["role"])
    .index("by_org_role", ["organizationId", "role"]),

  // ---- Master lists (organisation-wide) ----------------------------------

  categories: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(), // unique among its siblings (case-insensitive)
    /** Set for a sub-category: the top-level category it belongs to (one level only). */
    parentId: v.optional(v.id("categories")),
    sortOrder: v.number(), // order among its siblings
    archived: v.boolean(),
    createdAt: v.number(),
  }).index("by_org_order", ["organizationId", "sortOrder"]),

  items: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(),
    categoryId: v.id("categories"),
    baseUnit: vBaseUnit,
    aliases: v.array(v.string()),
    packSizes: v.array(vPackSize),
    variants: v.array(v.string()),
    /** The shop it is usually bought from (pre-filled on shopping lists). */
    defaultShopId: v.optional(v.id("shops")),
    status: vVerification,
    archived: v.boolean(),
    createdBy: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_org", ["organizationId"])
    .index("by_org_status", ["organizationId", "status"])
    .index("by_default_shop", ["defaultShopId"]),

  shops: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(),
    type: vShopType,
    note: v.optional(v.string()), // area or note
    status: vVerification,
    archived: v.boolean(),
    createdBy: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_org", ["organizationId"])
    .index("by_org_status", ["organizationId", "status"]),

  // ---- Purchases -----------------------------------------------------------

  /** One shopping trip at one shop. Deleting sets deletedAt (soft delete). */
  entries: defineTable({
    organizationId: v.id("organizations"),
    /** The property it was bought for; absent for a Shared entry. */
    propertyId: v.optional(v.id("properties")),
    /** propertyId, or "shared". */
    scopeKey: v.string(),
    shopId: v.id("shops"),
    loggedAt: v.number(),
    note: v.optional(v.string()),
    totalPaise: v.number(),
    lineCount: v.number(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedBy: v.optional(v.id("users")),
    updatedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
    deletedBy: v.optional(v.id("users")),
  })
    .index("by_org_loggedAt", ["organizationId", "loggedAt"])
    .index("by_scope_loggedAt", ["organizationId", "scopeKey", "loggedAt"])
    .index("by_shop", ["shopId"])
    .index("by_createdBy_loggedAt", ["createdBy", "loggedAt"]),

  /**
   * One item on an entry. Scope, time, category and shop are copied from the
   * entry/item so the history pages can query lines directly. Lines of a
   * deleted entry carry `deleted: true`.
   */
  entryLines: defineTable({
    entryId: v.id("entries"),
    organizationId: v.id("organizations"),
    itemId: v.id("items"),
    variant: v.optional(v.string()),
    quantity: v.number(), // in the item's base unit
    packLabel: v.optional(v.string()),
    packCount: v.optional(v.number()),
    totalPaise: v.number(),
    unitPricePaise: v.number(), // per base unit, rounded to the paisa
    // Denormalised for fast queries.
    propertyId: v.optional(v.id("properties")),
    scopeKey: v.string(),
    loggedAt: v.number(),
    categoryId: v.id("categories"),
    shopId: v.id("shops"),
    deleted: v.boolean(),
  })
    .index("by_entry", ["entryId"])
    .index("by_item_loggedAt", ["itemId", "loggedAt"])
    .index("by_scope_loggedAt", ["organizationId", "scopeKey", "loggedAt"])
    .index("by_org_loggedAt", ["organizationId", "loggedAt"])
    .index("by_shop_loggedAt", ["shopId", "loggedAt"])
    .index("by_category_loggedAt", ["categoryId", "loggedAt"]),

  /**
   * The live shopping lists: one per property and one Shared (scopeKey as on
   * entries). A row is an item to buy (List mode). Ticking it off in Buy
   * mode fills `bought`; "Save purchases" turns the bought rows into entries
   * (one per shop) and clears `bought`, keeping the row for next time.
   */
  shoppingListItems: defineTable({
    organizationId: v.id("organizations"),
    scopeKey: v.string(),
    propertyId: v.optional(v.id("properties")),
    itemId: v.id("items"),
    variant: v.optional(v.string()),
    quantity: v.number(), // planned, in the item's base unit
    packLabel: v.optional(v.string()),
    packCount: v.optional(v.number()),
    shopId: v.optional(v.id("shops")), // where it is to be bought
    /** Price per unit typed in List mode; otherwise the estimate uses the last price paid. */
    expectedUnitPricePaise: v.optional(v.number()),
    addedBy: v.id("users"),
    createdAt: v.number(),
    updatedBy: v.optional(v.id("users")),
    updatedAt: v.optional(v.number()),
    /** Set when ticked off in Buy mode: what was actually bought. */
    bought: v.optional(
      v.object({
        quantity: v.number(),
        packLabel: v.optional(v.string()),
        packCount: v.optional(v.number()),
        variant: v.optional(v.string()),
        shopId: v.id("shops"),
        totalPaise: v.number(),
        unitPricePaise: v.number(),
        boughtBy: v.id("users"),
        boughtAt: v.number(),
      }),
    ),
  })
    .index("by_scope", ["organizationId", "scopeKey"])
    .index("by_item", ["itemId"])
    .index("by_shop", ["shopId"]),

  // Sign-in abuse protection (as in the Staff app): failed attempts per phone.
  authAttemptLimits: defineTable({
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
  }).index("by_key", ["key"]),

  // Append-only log of every change. Never store passwords or tokens here.
  auditLog: defineTable({
    organizationId: v.optional(v.id("organizations")), // absent for setup steps outside any organisation
    actorUserId: v.optional(v.id("users")), // absent for setup steps run from the CLI
    action: v.string(),
    entityType: v.string(),
    entityId: v.string(),
    metadata: v.optional(v.any()), // e.g. { before, after }
    createdAt: v.number(),
  })
    .index("by_org_createdAt", ["organizationId", "createdAt"])
    .index("by_entity", ["entityType", "entityId"]),
});
