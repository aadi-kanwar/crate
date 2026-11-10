import type { BaseUnit, Role, ShopType } from "@convex/lib/validators";

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  manager: "Manager / Warden",
  kitchen_staff: "Kitchen Staff",
};

export const ROLE_OPTIONS: { value: Role; label: string; hint: string }[] = [
  {
    value: "kitchen_staff",
    label: ROLE_LABEL.kitchen_staff,
    hint: "Adds and edits purchases for their properties.",
  },
  {
    value: "manager",
    label: ROLE_LABEL.manager,
    hint: "Adds and edits purchases for their properties.",
  },
  {
    value: "admin",
    label: ROLE_LABEL.admin,
    hint: "Everything: every property, history, lists, users.",
  },
];

/** "kg", "litre"…, and the plural used after a number. */
export const UNIT_LABEL: Record<BaseUnit, { one: string; many: string }> = {
  kg: { one: "kg", many: "kg" },
  litre: { one: "litre", many: "litres" },
  piece: { one: "piece", many: "pieces" },
  dozen: { one: "dozen", many: "dozen" },
  cylinder: { one: "cylinder", many: "cylinders" },
};

export const SHOP_TYPE_LABEL: Record<ShopType, string> = {
  wholesaler: "Wholesaler",
  kirana: "Kirana",
  mandi: "Mandi / Vendor",
  dairy: "Dairy",
  lpg_agency: "LPG agency",
  other: "Other",
};
