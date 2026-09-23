import type { Machine, Priority } from "../domain/types";

export type Role = "admin" | "planner" | "supervisor" | "viewer";
export type StageStatus = "queued" | "in_progress" | "on_hold" | "completed";
export interface Member {
  userId: string;
  name: string;
  email: string;
  role: Role;
}
export interface Tenant {
  id: string;
  name: string;
  timeZone: string;
  horizonDays: number;
  dispatchBufferDays: number;
  revision: number;
  createdAt: string;
}
export interface Material {
  id: string;
  code: string;
  name: string;
  unit: "kg" | "pcs" | "m" | "l";
  stockMilli: number;
  reorderMilli: number;
  leadTimeDays: number;
}
export interface BomLine {
  materialId: string;
  quantityMilliPerUnit: number;
}
export interface RoutingStep {
  id: string;
  name: string;
  machineId: string;
  minutesPerUnit: number;
  setupMinutes: number;
}
export interface Product {
  id: string;
  sku: string;
  name: string;
  bom: BomLine[];
  routing: RoutingStep[];
}
export interface Stage extends RoutingStep {
  sequence: number;
  status: StageStatus;
  completedQuantity: number;
  startedAt: string | null;
  completedAt: string | null;
  holdReason: string | null;
  setupCompleted: boolean;
  workSessions: Array<{ startedAt: string; endedAt: string | null }>;
}
export interface ProductionOrder {
  id: string;
  number: string;
  customer: string;
  productId: string;
  productName: string;
  quantity: number;
  priority: Priority;
  deadline: string;
  bom: BomLine[];
  stages: Stage[];
  materialsIssued: boolean;
  createdAt: string;
  completedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
}
export interface Receipt {
  id: string;
  materialId: string;
  quantityMilli: number;
  expectedDate: string;
  reference: string;
  status: "expected" | "received" | "cancelled";
  receivedAt: string | null;
}
export interface InventoryMovement {
  id: string;
  materialId: string;
  deltaMilli: number;
  reason: string;
  type: "opening" | "receipt" | "adjustment" | "production";
  orderId: string | null;
  receiptId: string | null;
  createdAt: string;
  actorId: string;
}
export interface Allocation {
  id: string;
  orderId: string;
  stageId: string;
  machineId: string;
  date: string;
  startMinute: number;
  minutes: number;
  locked: boolean;
  manual: boolean;
}
export interface Risk {
  id: string;
  orderId: string;
  code: "material" | "capacity" | "deadline" | "hold" | "delay";
  severity: "warning" | "critical";
  message: string;
  materialId?: string;
  shortageMilli?: number;
  earliestDate?: string;
}
export interface OrderPlan {
  orderId: string;
  status:
    | "queued"
    | "scheduled"
    | "in_progress"
    | "on_hold"
    | "completed"
    | "delayed"
    | "at_risk"
    | "blocked"
    | "cancelled";
  start: string | null;
  finish: string | null;
  requiredMinutes: number;
  plannedMinutes: number;
  risks: Risk[];
}
export interface Plan {
  startDate: string;
  endDate: string;
  generatedAt: string;
  allocations: Allocation[];
  orders: OrderPlan[];
  risks: Risk[];
  strategy: "priority" | "deadline" | "shortest" | "material";
  score: {
    lateOrders: number;
    lateDays: number;
    blockedOrders: number;
    plannedMinutes: number;
  };
}
export interface Notification {
  id: string;
  title: string;
  message: string;
  orderId: string | null;
  createdAt: string;
  readAt: string | null;
  severity: "info" | "warning" | "critical";
}
export interface AuditEntry {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  targetId: string | null;
  createdAt: string;
  before: unknown;
  after: unknown;
  revision: number;
}
export interface Workspace {
  demo?: { expiresAt: string };
  tenant: Tenant;
  role: Role;
  user: { id: string; name: string; email: string };
  memberships: Array<{ tenantId: string; name: string; role: Role }>;
  machines: Machine[];
  materials: Material[];
  products: Product[];
  orders: ProductionOrder[];
  receipts: Receipt[];
  plan: Plan | null;
  notifications: Notification[];
  unreadCount: number;
  integrations: { email: boolean; ai: boolean; emailDisabled: boolean };
}
export interface PlanningInput {
  tenant: Pick<Tenant, "timeZone" | "horizonDays" | "dispatchBufferDays">;
  machines: Machine[];
  materials: Material[];
  orders: ProductionOrder[];
  receipts: Receipt[];
  previousPlan?: Plan | null;
}
