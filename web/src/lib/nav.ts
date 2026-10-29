import type { AppRole } from "./types";

export interface NavItem {
  href: string;
  label: string;
  roles: AppRole[];
  group: "money" | "catalog" | "admin";
}

const ALL: AppRole[] = ["super_admin", "label_admin", "author_composer"];

export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Overview", roles: ALL, group: "money" },
  { href: "/royalties", label: "Royalties", roles: ALL, group: "money" },
  { href: "/statements", label: "Statements", roles: ALL, group: "money" },
  { href: "/payments", label: "Payments & invoices", roles: ALL, group: "money" },
  { href: "/catalog", label: "Works & catalog", roles: ALL, group: "catalog" },
  { href: "/submissions", label: "Work submissions", roles: ALL, group: "catalog" },
  { href: "/contracts", label: "Contracts", roles: ALL, group: "catalog" },
  { href: "/uploads", label: "Report uploads", roles: ["super_admin"], group: "admin" },
  { href: "/people", label: "People & access", roles: ["super_admin", "label_admin"], group: "admin" },
  { href: "/audit", label: "Audit log", roles: ["super_admin"], group: "admin" },
];

export const GROUP_LABEL: Record<NavItem["group"], string> = {
  money: "Earnings",
  catalog: "Catalog",
  admin: "Administration",
};

export function canSee(role: AppRole, href: string): boolean {
  const item = NAV.find((n) => href === n.href || href.startsWith(n.href + "/"));
  return !item || item.roles.includes(role);
}
