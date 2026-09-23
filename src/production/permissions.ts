import type { Role } from "./types";
export type Permission =
  | "read"
  | "plan"
  | "orders"
  | "inventory"
  | "masters"
  | "floor"
  | "members"
  | "audit"
  | "settings";
const allowed: Record<Role, readonly Permission[]> = {
  admin: [
    "read",
    "plan",
    "orders",
    "inventory",
    "masters",
    "floor",
    "members",
    "audit",
    "settings",
  ],
  planner: ["read", "plan", "orders", "inventory", "masters"],
  supervisor: ["read", "floor"],
  viewer: ["read"],
};
export function can(role: Role, permission: Permission) {
  return allowed[role]?.includes(permission) ?? false;
}
