export type Day = string;
export type Priority = "urgent" | "high" | "normal" | "low";
export type OrderState = "open" | "in_progress" | "completed";
export interface Shift {
  weekday: number;
  startMinute: number;
  endMinute: number;
}
export interface Downtime {
  id: string;
  date: Day;
  startMinute: number;
  endMinute: number;
  reason: string;
}
export interface Machine {
  id: string;
  name: string;
  code: string;
  kind: string;
  dailyCapacityMinutes: number;
  shifts: Shift[];
  downtime: Downtime[];
}
export interface Material {
  id: string;
  name: string;
  code: string;
  stockGrams: number;
  reorderGrams: number;
}
export interface BomLine {
  materialId: string;
  gramsPerUnit: number;
}
export interface Product {
  id: string;
  name: string;
  sku: string;
  machineId: string;
  minutesPerUnit: number;
  bom: BomLine[];
}
export interface Order {
  id: string;
  customer: string;
  productId: string;
  quantity: number;
  priority: Priority;
  deadline: Day;
  state: OrderState;
}
export interface Allocation {
  id: string;
  orderId: string;
  machineId: string;
  date: Day;
  startMinute: number;
  minutes: number;
  locked: boolean;
  manual?: boolean;
}
export interface Factory {
  name: string;
  today: Day;
  horizonEnd: Day;
  machines: Machine[];
  materials: Material[];
  products: Product[];
  orders: Order[];
  frozen: Allocation[];
}
export type ConflictCode =
  | "MATERIAL_SHORTAGE"
  | "CAPACITY_SHORTAGE"
  | "MACHINE_OVERLOAD"
  | "DEADLINE_RISK"
  | "DEADLINE_VIOLATION"
  | "IMPOSSIBLE_SCHEDULE"
  | "DOWNTIME_OVERLAP";
export interface Conflict {
  id: string;
  code: ConflictCode;
  severity: "warning" | "critical";
  orderId?: string;
  machineId?: string;
  materialId?: string;
  date?: Day;
  required?: number;
  available?: number;
  unit?: "minutes" | "grams";
  message: string;
  action: string;
}
export type ScheduleStatus =
  | "scheduled"
  | "in_progress"
  | "completed"
  | "at_risk"
  | "delayed"
  | "blocked"
  | "unscheduled";
export interface OrderResult {
  orderId: string;
  status: ScheduleStatus;
  start?: Day;
  finish?: Day;
  requiredMinutes: number;
  scheduledMinutes: number;
  explanation: string;
  conflicts: Conflict[];
}
export interface MaterialBalance {
  materialId: string;
  stockGrams: number;
  allocatedGrams: number;
  remainingGrams: number;
  demandGrams: number;
  shortageGrams: number;
}
export interface Schedule {
  allocations: Allocation[];
  orders: OrderResult[];
  conflicts: Conflict[];
  materials: MaterialBalance[];
}
export interface Workspace {
  factory: Factory;
  schedule: Schedule | null;
  revision: number;
  updatedAt: string | null;
}
