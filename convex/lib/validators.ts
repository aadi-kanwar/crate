import { v, type Infer } from "convex/values";

/**
 * Account roles. Admins see and change everything; managers/wardens and
 * kitchen staff have the same rights: entries for the properties they are
 * assigned to.
 */
export const ROLES = ["admin", "manager", "kitchen_staff"] as const;
export const vRole = v.union(
  v.literal("admin"),
  v.literal("manager"),
  v.literal("kitchen_staff"),
);
export type Role = Infer<typeof vRole>;

/** The roles that make entries for their assigned properties. */
export const vMemberRole = v.union(
  v.literal("manager"),
  v.literal("kitchen_staff"),
);
export type MemberRole = Infer<typeof vMemberRole>;

/** Organisations and properties: archived ones are kept for history but hidden. */
export const vRecordStatus = v.union(
  v.literal("active"),
  v.literal("archived"),
);

/** The unit an item is counted in. Fixed per item; staff never choose units. */
export const BASE_UNITS = ["kg", "litre", "piece", "dozen", "cylinder"] as const;
export const vBaseUnit = v.union(
  v.literal("kg"),
  v.literal("litre"),
  v.literal("piece"),
  v.literal("dozen"),
  v.literal("cylinder"),
);
export type BaseUnit = Infer<typeof vBaseUnit>;

export const SHOP_TYPES = [
  "wholesaler",
  "kirana",
  "mandi",
  "dairy",
  "lpg_agency",
  "other",
] as const;
export const vShopType = v.union(
  v.literal("wholesaler"),
  v.literal("kirana"),
  v.literal("mandi"),
  v.literal("dairy"),
  v.literal("lpg_agency"),
  v.literal("other"),
);
export type ShopType = Infer<typeof vShopType>;

/** Items and shops added by staff while entering start unverified; an admin verifies them. */
export const vVerification = v.union(
  v.literal("verified"),
  v.literal("unverified"),
);

export const vPackSize = v.object({
  label: v.string(), // e.g. "500 ml packet"
  quantity: v.number(), // in the item's base unit, e.g. 0.5
});
export type PackSize = Infer<typeof vPackSize>;
