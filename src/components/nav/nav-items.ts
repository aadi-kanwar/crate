import {
  House,
  ListChecks,
  ReceiptText,
  Settings,
  ShoppingBasket,
  SquarePlus,
  UserRound,
  Users,
  ScrollText,
  ShoppingCart,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** In the phone's bottom bar (default true), or under its "More" tab (false). The sidebar shows everything. */
  mobile?: boolean;
};

export const ADMIN_NAV: NavItem[] = [
  { href: "/admin", label: "Entries", icon: ReceiptText },
  { href: "/admin/shopping", label: "Shopping list", icon: ShoppingCart },
  { href: "/admin/items", label: "Items", icon: ShoppingBasket },
  { href: "/admin/lists", label: "Lists", icon: ListChecks },
  { href: "/admin/users", label: "Users", icon: Users, mobile: false },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText, mobile: false },
  { href: "/admin/settings", label: "Settings", icon: Settings, mobile: false },
];

/** Manager / kitchen staff screens (bottom bar on every screen size). */
export const MEMBER_NAV: NavItem[] = [
  { href: "/me", label: "Home", icon: House },
  { href: "/me/new", label: "New entry", icon: SquarePlus },
  { href: "/me/shopping", label: "Shopping list", icon: ShoppingCart },
  { href: "/me/account", label: "Account", icon: UserRound },
];
