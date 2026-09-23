"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Factory,
  LayoutDashboard,
  CalendarRange,
  ClipboardList,
  Package,
  Boxes,
  Settings2,
  Users,
  Activity,
  Bell,
  LogOut,
  RefreshCw,
  Plus,
  ArrowUpRight,
  Search,
  Download,
  Sparkles,
} from "lucide-react";
import { Modal, PriorityBadge, fmtDate, clockTime } from "../../components/ui";
import { can } from "../permissions";
import { analytics } from "../analytics";
import { localDay, quantity } from "../dates";
import type { Action } from "../validation";
import type {
  Workspace,
  ProductionOrder,
  AuditEntry,
  InventoryMovement,
} from "../types";
import {
  DraftRecovery,
  Field,
  FormDialog,
  OrderForm,
  MachineForm,
  MaterialForm,
  ProductForm,
  ReceiptForm,
  SettingsForm,
} from "./forms";
import { ProductionBoard } from "./board";
import { ImportOrders } from "./import-orders";
import { TeamView } from "./team";
import { api, appUrl, isDemoMode, reportUrl } from "./client";
import { DemoBanner } from "./demo-entry";
import {
  SetupChecklist,
  WorkspaceTour,
  type AppView as View,
} from "./onboarding";
import { ProductIntroduction } from "../../components/product-tour";
type Dialog = {
  revision?: number;
  kind:
    | "order"
    | "machine"
    | "material"
    | "product"
    | "receipt"
    | "settings"
    | "import"
    | "adjust"
    | "stage"
    | "detail"
    | "confirm"
    | "unit"
    | "optimize";
  id?: string;
  orderId?: string;
  transition?: "hold" | "progress";
  action?: Action;
  title?: string;
  message?: string;
};
const labels: Record<string, string> = {
  in_progress: "In progress",
  on_hold: "On hold",
  at_risk: "At risk",
  scheduled: "Scheduled",
  queued: "Queued",
  completed: "Completed",
  delayed: "Delayed",
  blocked: "Material shortage",
  cancelled: "Cancelled",
};
export function Status({ value }: { value: string }) {
  return <span className={`p-status ${value}`}>{labels[value] ?? value}</span>;
}
const navigation = [
  { id: "overview", name: "Overview", icon: LayoutDashboard },
  { id: "planning", name: "Planning board", icon: CalendarRange },
  { id: "orders", name: "Orders", icon: ClipboardList },
  { id: "floor", name: "Production floor", icon: Activity },
  { id: "materials", name: "Materials & stock", icon: Boxes },
  { id: "products", name: "Products & BOM", icon: Package },
  { id: "machines", name: "Work centers", icon: Settings2 },
  { id: "reports", name: "Reports", icon: Download },
  { id: "team", name: "Team", icon: Users },
  { id: "audit", name: "Audit log", icon: Activity },
  { id: "notifications", name: "Notifications", icon: Bell },
] as const;
export function Platform() {
  const [data, setData] = useState<Workspace | null>(null),
    [loaded, setLoaded] = useState(false),
    [units, setUnits] = useState<Workspace["memberships"]>([]),
    [view, setView] = useState<View>("overview"),
    [dialog, setDialogState] = useState<Dialog | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("all"),
    [riskLimit, setRiskLimit] = useState(100);
  const current = useRef<Workspace | null>(null),
    pending = useRef(false),
    loading = useRef(0);
  function setDialog(next: Dialog | null) {
    setDialogState(
      next ? { ...next, revision: current.current?.tenant.revision } : null,
    );
  }
  const assign = useCallback((next: Workspace) => {
    current.current = next;
    setData(next);
    setUnits(next.memberships);
  }, []);
  const load = useCallback(
    async (tenantId: string) => {
      const epoch = ++loading.current;
      const next = await api<Workspace>(`workspace?tenantId=${tenantId}`);
      if (epoch === loading.current) assign(next);
    },
    [assign],
  );
  const refresh = useCallback(async () => {
    if (current.current) await load(current.current.tenant.id);
  }, [load]);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const query = new URLSearchParams(location.search);
        const invite = isDemoMode() ? null : query.get("invite");
        if (invite) {
          sessionStorage.setItem("prodplan-invite", invite);
          history.replaceState(null, "", "/app");
        }
        const result = await api<{ memberships: Workspace["memberships"] }>(
          "units",
        );
        if (!active) return;
        setUnits(result.memberships);
        const token = isDemoMode()
          ? null
          : sessionStorage.getItem("prodplan-invite");
        let acceptedUnit: string | undefined;
        if (token) {
          try {
            const accepted = await api<{ tenantId: string }>("team", {
              action: "accept",
              token,
            });
            acceptedUnit = accepted.tenantId;
          } catch (e) {
            if (active)
              setError(
                `${e instanceof Error ? e.message : "Could not accept this invitation."} Your existing workspaces are still available. To use a different account, sign out and reopen the original invitation link.`,
              );
          } finally {
            sessionStorage.removeItem("prodplan-invite");
          }
        }
        const selectedId =
          acceptedUnit ??
          (
            result.memberships.find((m) => m.tenantId === query.get("unit")) ??
            result.memberships[0]
          )?.tenantId;
        if (selectedId) {
          await load(selectedId);
          history.replaceState(null, "", appUrl(selectedId));
        }
      } catch (e) {
        if (active)
          setError(
            e instanceof Error ? e.message : "Could not open the workspace.",
          );
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [load]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && !pending.current)
        void refresh().catch(() => undefined);
    }, 15000);
    return () => clearInterval(timer);
  }, [refresh]);
  async function save(action: Action, baseRevision?: number) {
    if (pending.current)
      throw new Error("A change is already being saved. Please wait.");
    const workspace = current.current;
    if (!workspace) throw new Error("Select a workspace first.");
    pending.current = true;
    setBusy(true);
    setError("");
    ++loading.current;
    const payload = {
      tenantId: workspace.tenant.id,
      revision: baseRevision ?? workspace.tenant.revision,
      key: crypto.randomUUID(),
      ...action,
    };
    try {
      const next = await api<Workspace>("workspace", payload);
      assign(next);
      setNotice("Changes saved. The production plan is up to date.");
    } catch (e) {
      await refresh().catch(() => undefined);
      throw e;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function perform(action: Action) {
    try {
      await save(action);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this change.");
    }
  }
  async function signout() {
    try {
      const r = await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!r.ok) throw new Error("Could not sign out.");
      // Discard all private workspace state after ending the session.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      location.assign("/login");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sign out.");
    }
  }
  const navigate = useCallback((next: View) => {
    setView(next);
    setSearch("");
    setStatus("all");
    setError("");
    setNotice("");
  }, []);
  async function createUnit(form: FormData) {
    const result = await api<{ tenantId: string }>("units", {
      name: String(form.get("name")),
      timeZone: String(form.get("timezone")),
      horizonDays: 30,
      dispatchBufferDays: 1,
    });
    await load(result.tenantId);
    history.replaceState(null, "", `/app?unit=${result.tenantId}`);
    setDialog(null);
  }
  const unitForm = (
    <>
      <Field label="Manufacturing unit">
        <input
          name="name"
          required
          maxLength={120}
          placeholder="e.g. Cairo Plant"
        />
      </Field>
      <Field label="Plant time zone">
        <input
          name="timezone"
          required
          defaultValue={Intl.DateTimeFormat().resolvedOptions().timeZone}
          list="unit-timezones"
        />
        <datalist id="unit-timezones">
          {Intl.supportedValuesOf("timeZone").map((tz) => (
            <option key={tz}>{tz}</option>
          ))}
        </datalist>
      </Field>
      <p className="muted">
        This workspace has its own team, inventory and production schedule.
      </p>
    </>
  );
  if (!loaded)
    return (
      <main className="platform auth-page">
        <p role="status">Opening your workspace…</p>
      </main>
    );
  if (!data)
    return (
      <main className="platform auth-page">
        <section className="auth-card">
          <div className="auth-brand">
            <Factory />
            ProdPlan
          </div>
          <h1>Create your first workspace</h1>
          <p className="muted">
            Start with one manufacturing unit. You can add other plants later.
          </p>
          <ProductIntroduction finishLabel="Set up my workspace" />
          {error && (
            <p className="p-error" role="alert">
              {error}
            </p>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              setBusy(true);
              try {
                await createUnit(form);
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : "Could not create the workspace.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {unitForm}
            <button className="button primary" disabled={busy}>
              Create workspace
            </button>
          </form>
          <button className="auth-demo-link" onClick={() => void signout()}>
            Sign out
          </button>
        </section>
      </main>
    );
  const props = {
      key: dialog?.revision,
      data,
      save: (action: Action) => save(action, dialog?.revision),
      close: () => setDialog(null),
    },
    stats = analytics(data),
    today = localDay(data.tenant.timeZone),
    orders = data.orders
      .filter(
        (o) =>
          `${o.number} ${o.customer} ${o.productName}`
            .toLowerCase()
            .includes(search.toLowerCase()) &&
          (status === "all" ||
            (data.plan?.orders.find((p) => p.orderId === o.id)?.status ??
              "queued") === status),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const editable = can(data.role, "masters"),
    orderAccess = can(data.role, "orders"),
    floorAccess = can(data.role, "floor"),
    planAccess = can(data.role, "plan");
  const selectedOrder = dialog?.orderId
    ? data.orders.find((o) => o.id === dialog.orderId)
    : dialog?.id
      ? data.orders.find((o) => o.id === dialog.id)
      : undefined;
  function orderStatus(order: ProductionOrder) {
    return (
      data?.plan?.orders.find((p) => p.orderId === order.id)?.status ?? "queued"
    );
  }
  const risks = (
    <div className="p-risk-list">
      {data.plan?.risks.length ? (
        data.plan.risks.slice(0, riskLimit).map((risk) => (
          <button
            className={`p-risk ${risk.severity}`}
            key={risk.id}
            onClick={() => setDialog({ kind: "detail", id: risk.orderId })}
          >
            <span>
              <strong>
                {data.orders.find((o) => o.id === risk.orderId)?.number}
              </strong>
              <Status value={risk.code} />
            </span>
            <p>{risk.message}</p>
            <ArrowUpRight size={16} />
          </button>
        ))
      ) : (
        <div className="p-empty">
          <h3>No production conflicts</h3>
          <p>
            {data.orders.length
              ? "The current plan fits the entered constraints."
              : "Add an order to check materials, capacity and deadlines."}
          </p>
        </div>
      )}
    </div>
  );
  const riskPagination =
    data.plan && data.plan.risks.length > riskLimit ? (
      <button className="button" onClick={() => setRiskLimit(riskLimit + 100)}>
        Show more conflicts ({data.plan.risks.length - riskLimit} remaining)
      </button>
    ) : null;
  const orderTable = (
    <div className="p-panel p-table-scroll">
      <table>
        <thead>
          <tr>
            <th>Order / customer</th>
            <th>Product</th>
            <th>Quantity</th>
            <th>Priority</th>
            <th>Deadline</th>
            <th>Forecast</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => {
            const forecast = data.plan?.orders.find(
              (o) => o.orderId === order.id,
            );
            return (
              <tr key={order.id}>
                <td>
                  <button
                    className="p-link"
                    onClick={() => setDialog({ kind: "detail", id: order.id })}
                  >
                    {order.number}
                  </button>
                  <small>{order.customer}</small>
                </td>
                <td>{order.productName}</td>
                <td>{order.quantity.toLocaleString()}</td>
                <td>
                  <PriorityBadge priority={order.priority} />
                </td>
                <td>{fmtDate(order.deadline)}</td>
                <td>
                  {forecast?.finish ? fmtDate(forecast.finish) : "Unplanned"}
                </td>
                <td>
                  {order.deliveredAt ? (
                    <Status value="Delivered" />
                  ) : (
                    <Status value={orderStatus(order)} />
                  )}
                </td>
                <td>
                  <button
                    className="button"
                    onClick={() => setDialog({ kind: "detail", id: order.id })}
                  >
                    Open
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!orders.length && (
        <div className="p-empty">
          <h3>
            {search || status !== "all"
              ? "No matching orders"
              : "No orders yet"}
          </h3>
          <p>
            {data.products.length
              ? "Create an order or import a CSV to start planning."
              : "Add materials, work centers and a product first."}
          </p>
        </div>
      )}
    </div>
  );
  return (
    <DraftRecovery.Provider
      value={() =>
        setDialogState(
          dialog
            ? { ...dialog, revision: current.current?.tenant.revision }
            : null,
        )
      }
    >
      <div className="platform p-shell">
        <aside className="p-sidebar">
          <a className="auth-brand" href={appUrl(data.tenant.id)}>
            <Factory size={28} />
            ProdPlan
          </a>
          <Field label="Workspace">
            <select
              aria-label="Select workspace"
              value={data.tenant.id}
              onChange={async (e) => {
                const id = e.target.value;
                setDialog(null);
                pending.current = true;
                setBusy(true);
                try {
                  await load(id);
                  navigate("overview");
                  history.replaceState(null, "", appUrl(id));
                } catch (e) {
                  setError(
                    e instanceof Error
                      ? e.message
                      : "Could not switch workspaces.",
                  );
                } finally {
                  pending.current = false;
                  setBusy(false);
                }
              }}
              disabled={busy || !!data.demo}
            >
              {units.map((m) => (
                <option value={m.tenantId} key={m.tenantId}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
          <nav aria-label="Main navigation">
            {navigation
              .filter(
                (item) =>
                  (item.id !== "team" && item.id !== "audit") ||
                  data.role === "admin",
              )
              .map((item) => (
                <button
                  className={view === item.id ? "active" : ""}
                  key={item.id}
                  onClick={() => navigate(item.id)}
                >
                  <item.icon size={18} />
                  <span>{item.name}</span>
                  {item.id === "notifications" && data.unreadCount > 0 && (
                    <b>{data.unreadCount}</b>
                  )}
                </button>
              ))}
          </nav>
          <div className="p-sidebar-bottom">
            {!data.demo && (
              <>
                <button
                  className="button"
                  onClick={() => setDialog({ kind: "unit" })}
                >
                  <Plus size={16} />
                  Add workspace
                </button>
              </>
            )}
            <p>
              <strong>{data.user.name}</strong>
              <small>
                {data.role} · {data.user.email}
              </small>
            </p>
            {data.demo ? (
              <Link className="button" href="/">
                Leave demo
              </Link>
            ) : (
              <button className="button" onClick={() => void signout()}>
                <LogOut size={16} />
                Sign out
              </button>
            )}
          </div>
        </aside>
        <main className="p-main">
          {data.demo && <DemoBanner expiresAt={data.demo.expiresAt} />}
          <header className="p-page-header">
            <div>
              <p className="eyebrow">
                {data.tenant.name} /{" "}
                {fmtDate(today, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
              <h1>{navigation.find((n) => n.id === view)?.name}</h1>
            </div>
            <div className="p-actions">
              <WorkspaceTour
                key={`${data.user.id}:${data.role}`}
                data={data}
                navigate={navigate}
              />
              <span className="p-live">
                {busy
                  ? "Saving…"
                  : data.demo
                    ? "Demo workspace"
                    : "Live workspace"}
              </span>
              <button
                className="button"
                aria-label="Refresh workspace"
                onClick={() => void refresh().catch((e) => setError(e.message))}
                disabled={busy}
              >
                <RefreshCw size={16} />
              </button>
              {data.role === "admin" && (
                <button
                  className="button"
                  aria-label="Workspace settings"
                  onClick={() => setDialog({ kind: "settings" })}
                >
                  <Settings2 size={16} />
                </button>
              )}
            </div>
          </header>
          {error && (
            <p className="p-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="p-success" role="status">
              {notice}
              <button
                aria-label="Dismiss message"
                onClick={() => setNotice("")}
              >
                ×
              </button>
            </p>
          )}
          <div data-tour="view-content" key={view}>
            {view === "overview" && (
              <>
                <SetupChecklist data={data} navigate={navigate} />
                <div className="p-metrics">
                  <Metric
                    label="Active orders"
                    value={stats.active}
                    note="Awaiting production completion"
                  />
                  <Metric
                    label="Delivery overdue"
                    value={stats.overdue}
                    note="Not yet confirmed delivered"
                  />
                  <Metric
                    label="On-time delivery"
                    value={
                      stats.onTimePercent === null
                        ? "No deliveries"
                        : `${stats.onTimePercent}%`
                    }
                    note={`${stats.onTime} of ${stats.delivered} confirmed deliveries`}
                  />
                  <Metric
                    label="Completed units"
                    value={stats.throughput.toLocaleString()}
                    note="Across completed production orders"
                  />
                </div>
                <div className="p-two-columns">
                  <section>
                    <div className="p-section-head">
                      <h2>Needs attention</h2>
                      <button
                        className="p-link"
                        onClick={() => navigate("planning")}
                      >
                        Open plan
                      </button>
                    </div>
                    {risks}
                    {riskPagination}
                  </section>
                  <section className="p-panel p-padding">
                    <h2>Planned work-center utilization</h2>
                    <p className="muted">
                      {data.plan
                        ? `${fmtDate(data.plan.startDate)} to ${fmtDate(data.plan.endDate)}`
                        : "No schedule yet"}
                    </p>
                    <Utilization items={stats.utilization} />
                    <small>
                      Planned minutes ÷ available shift minutes after downtime
                      and capacity caps.
                    </small>
                  </section>
                </div>
              </>
            )}
            {view === "planning" && (
              <>
                <div className="p-toolbar">
                  <p className="muted">
                    Capacity, material availability and delivery deadlines in
                    one plan.
                  </p>
                  {planAccess && (
                    <div className="p-actions">
                      <button
                        className="button"
                        onClick={() => setDialog({ kind: "optimize" })}
                        disabled={busy || !data.orders.length}
                      >
                        <Sparkles size={16} />
                        Compare schedules
                      </button>
                      <button
                        className="button primary"
                        onClick={() =>
                          void perform({
                            action: "plan.generate",
                            strategy: data.plan?.strategy ?? "priority",
                          })
                        }
                        disabled={busy}
                      >
                        Recalculate
                      </button>
                    </div>
                  )}
                </div>
                <ProductionBoard data={data} save={save} />
                <section data-tour="planning-risks">
                  <div className="p-section-head">
                    <h2>Conflicts & delivery risks</h2>
                    <span className="muted">
                      {data.plan?.risks.length ?? 0} issues
                    </span>
                  </div>
                  {risks}
                  {riskPagination}
                </section>
              </>
            )}
            {(view === "orders" || view === "floor") && (
              <>
                <div className="p-toolbar">
                  <div className="p-search">
                    <Search size={16} />
                    <input
                      aria-label="Search orders"
                      placeholder="Search orders, customers or products"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <div className="p-actions">
                    <select
                      aria-label="Filter order status"
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                    >
                      <option value="all">All statuses</option>
                      {Object.entries(labels).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                    {orderAccess && view === "orders" && (
                      <>
                        <button
                          className="button"
                          disabled={!data.products.length || busy}
                          onClick={() => setDialog({ kind: "import" })}
                        >
                          Import CSV
                        </button>
                        <button
                          className="button primary"
                          disabled={!data.products.length || busy}
                          onClick={() => setDialog({ kind: "order" })}
                        >
                          <Plus size={16} />
                          Create order
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {view === "orders" ? (
                  orderTable
                ) : (
                  <div className="p-floor-list">
                    {orders
                      .filter((o) => !o.cancelledAt && !o.completedAt)
                      .map((order) => (
                        <section className="p-panel p-padding" key={order.id}>
                          <div className="p-section-head">
                            <div>
                              <button
                                className="p-link"
                                onClick={() =>
                                  setDialog({ kind: "detail", id: order.id })
                                }
                              >
                                {order.number}
                              </button>
                              <h2>{order.productName}</h2>
                              <small>
                                {order.quantity} units · Due{" "}
                                {fmtDate(order.deadline)}
                              </small>
                            </div>
                            <Status value={orderStatus(order)} />
                          </div>
                          <StageList
                            order={order}
                            data={data}
                            allowed={floorAccess && !busy}
                            perform={perform}
                            setDialog={setDialog}
                          />
                        </section>
                      ))}
                    {!orders.some((o) => !o.cancelledAt && !o.completedAt) && (
                      <p className="p-empty">
                        No active production orders match this view.
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
            {view === "machines" && (
              <>
                <div className="p-toolbar">
                  <p className="muted">
                    Set weekly shifts, available capacity and planned downtime.
                  </p>
                  {editable && (
                    <button
                      className="button primary"
                      onClick={() => setDialog({ kind: "machine" })}
                    >
                      <Plus size={16} />
                      Add work center
                    </button>
                  )}
                </div>
                <div className="p-card-grid">
                  {data.machines.map((machine) => (
                    <section className="p-panel p-padding" key={machine.id}>
                      <div className="p-section-head">
                        <div>
                          <small>
                            {machine.code} · {machine.kind}
                          </small>
                          <h2>{machine.name}</h2>
                        </div>
                        {editable && (
                          <button
                            className="button"
                            onClick={() =>
                              setDialog({ kind: "machine", id: machine.id })
                            }
                          >
                            Edit
                          </button>
                        )}
                      </div>
                      <p className="p-large-number">
                        {machine.dailyCapacityMinutes / 60}
                        <small> hours / day</small>
                      </p>
                      <p className="muted">
                        {machine.shifts.length} weekly shifts ·{" "}
                        {machine.downtime.filter((d) => d.date >= today).length}{" "}
                        upcoming downtime periods
                      </p>
                      <div className="p-shift-summary">
                        {machine.shifts.map((shift, i) => (
                          <small key={i}>
                            {
                              ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
                                shift.weekday
                              ]
                            }{" "}
                            {clockTime(shift.startMinute)} to{" "}
                            {clockTime(shift.endMinute)}
                          </small>
                        ))}
                      </div>
                      {editable && (
                        <button
                          className="p-link p-danger"
                          onClick={() =>
                            setDialog({
                              kind: "confirm",
                              title: "Delete work center",
                              message:
                                "Only unused work centers can be deleted.",
                              action: {
                                action: "record.delete",
                                kind: "machine",
                                id: machine.id,
                              },
                            })
                          }
                        >
                          Delete work center
                        </button>
                      )}
                    </section>
                  ))}
                </div>
                {!data.machines.length && (
                  <Empty
                    title="Add your first work center"
                    text="A work center represents a machine or production station with its own calendar."
                  />
                )}
              </>
            )}
            {view === "materials" && (
              <>
                <div className="p-toolbar">
                  <p className="muted">
                    Stock is issued once when production starts.
                  </p>
                  {can(data.role, "inventory") && (
                    <div className="p-actions">
                      <button
                        className="button"
                        disabled={!data.materials.length}
                        onClick={() => setDialog({ kind: "receipt" })}
                      >
                        Expected receipt
                      </button>
                      <button
                        className="button primary"
                        onClick={() => setDialog({ kind: "material" })}
                      >
                        <Plus size={16} />
                        Add material
                      </button>
                    </div>
                  )}
                </div>
                <div className="p-panel p-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Material</th>
                        <th>On hand</th>
                        <th>Reorder level</th>
                        <th>Lead time</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {data.materials.map((m) => (
                        <tr key={m.id}>
                          <td>
                            <strong>{m.name}</strong>
                            <small>{m.code}</small>
                          </td>
                          <td>
                            <span
                              className={
                                m.stockMilli <= m.reorderMilli ? "p-danger" : ""
                              }
                            >
                              {quantity(m.stockMilli, m.unit)}
                            </span>
                          </td>
                          <td>{quantity(m.reorderMilli, m.unit)}</td>
                          <td>{m.leadTimeDays} days</td>
                          <td>
                            {editable && (
                              <div className="p-actions">
                                <button
                                  className="button"
                                  onClick={() =>
                                    setDialog({ kind: "adjust", id: m.id })
                                  }
                                >
                                  Adjust stock
                                </button>
                                <button
                                  className="button"
                                  onClick={() =>
                                    setDialog({ kind: "material", id: m.id })
                                  }
                                >
                                  Edit
                                </button>
                                <button
                                  className="button"
                                  onClick={() =>
                                    setDialog({
                                      kind: "confirm",
                                      title: "Delete material",
                                      message:
                                        "Only unused materials with no stock or inventory history can be deleted.",
                                      action: {
                                        action: "record.delete",
                                        kind: "material",
                                        id: m.id,
                                      },
                                    })
                                  }
                                >
                                  Delete
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!data.materials.length && (
                    <Empty
                      title="No materials yet"
                      text="Add raw materials and their opening stock."
                    />
                  )}
                </div>
                <h2 className="p-section-title">Purchase receipts</h2>
                <div className="p-panel p-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Reference</th>
                        <th>Material</th>
                        <th>Quantity</th>
                        <th>Arrival</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {data.receipts.map((r) => {
                        const m = data.materials.find(
                          (m) => m.id === r.materialId,
                        );
                        return (
                          <tr key={r.id}>
                            <td>{r.reference}</td>
                            <td>{m?.name}</td>
                            <td>{quantity(r.quantityMilli, m?.unit ?? "")}</td>
                            <td>
                              {fmtDate(r.expectedDate)}
                              {r.status === "expected" &&
                                r.expectedDate < today && (
                                  <small className="p-danger">
                                    Overdue. Update ETA.
                                  </small>
                                )}
                            </td>
                            <td>
                              <Status value={r.status} />
                            </td>
                            <td>
                              {editable && r.status === "expected" && (
                                <div className="p-actions">
                                  <button
                                    className="button"
                                    onClick={() =>
                                      setDialog({
                                        kind: "confirm",
                                        title: "Confirm material receipt",
                                        message: `Add ${quantity(r.quantityMilli, m?.unit ?? "")} to on-hand stock?`,
                                        action: {
                                          action: "receipt.receive",
                                          receiptId: r.id,
                                        },
                                      })
                                    }
                                  >
                                    Receive
                                  </button>
                                  <button
                                    className="button"
                                    onClick={() =>
                                      setDialog({ kind: "receipt", id: r.id })
                                    }
                                  >
                                    Edit
                                  </button>
                                  <button
                                    className="button"
                                    onClick={() =>
                                      setDialog({
                                        kind: "confirm",
                                        title: "Cancel expected receipt",
                                        message:
                                          "This receipt will no longer supply the production plan.",
                                        action: {
                                          action: "receipt.cancel",
                                          receiptId: r.id,
                                        },
                                      })
                                    }
                                  >
                                    Cancel
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {!data.receipts.length && (
                    <p className="p-empty">No purchase receipts.</p>
                  )}
                </div>
                <h2 className="p-section-title">Stock movement history</h2>
                <History data={data} kind="inventory" />
              </>
            )}
            {view === "products" && (
              <>
                <div className="p-toolbar">
                  <p className="muted">
                    Material requirements and sequential production stages for
                    every product.
                  </p>
                  {editable && (
                    <button
                      className="button primary"
                      disabled={!data.machines.length || !data.materials.length}
                      onClick={() => setDialog({ kind: "product" })}
                    >
                      <Plus size={16} />
                      Add product
                    </button>
                  )}
                </div>
                {(!data.machines.length || !data.materials.length) && (
                  <p className="p-setup">
                    Add at least one work center and one material before
                    creating a product.
                  </p>
                )}
                <div className="p-card-grid">
                  {data.products.map((product) => (
                    <section className="p-panel p-padding" key={product.id}>
                      <div className="p-section-head">
                        <div>
                          <small>{product.sku}</small>
                          <h2>{product.name}</h2>
                        </div>
                        {editable && (
                          <button
                            className="button"
                            onClick={() =>
                              setDialog({ kind: "product", id: product.id })
                            }
                          >
                            Edit
                          </button>
                        )}
                      </div>
                      <h3>Materials per unit</h3>
                      <ul className="p-detail-list">
                        {product.bom.map((line) => {
                          const m = data.materials.find(
                            (m) => m.id === line.materialId,
                          );
                          return (
                            <li key={line.materialId}>
                              <span>{m?.name}</span>
                              <strong>
                                {quantity(
                                  line.quantityMilliPerUnit,
                                  m?.unit ?? "",
                                )}
                              </strong>
                            </li>
                          );
                        })}
                      </ul>
                      <h3>Production route</h3>
                      <ol className="p-route">
                        {product.routing.map((step) => (
                          <li key={step.id}>
                            <strong>{step.name}</strong>
                            <small>
                              {
                                data.machines.find(
                                  (m) => m.id === step.machineId,
                                )?.name
                              }{" "}
                              · {step.minutesPerUnit} min/unit +{" "}
                              {step.setupMinutes} min setup
                            </small>
                          </li>
                        ))}
                      </ol>
                      {editable && (
                        <button
                          className="p-link p-danger"
                          onClick={() =>
                            setDialog({
                              kind: "confirm",
                              title: "Delete product",
                              message:
                                "Products referenced by orders must be retained for their history.",
                              action: {
                                action: "record.delete",
                                kind: "product",
                                id: product.id,
                              },
                            })
                          }
                        >
                          Delete product
                        </button>
                      )}
                    </section>
                  ))}
                </div>
                {!data.products.length && (
                  <Empty
                    title="No products yet"
                    text="Define a bill of materials and production route before creating customer orders."
                  />
                )}
              </>
            )}
            {view === "team" &&
              data.role === "admin" &&
              (data.demo ? (
                <section className="p-panel p-padding">
                  <h2>Invite your team in your own workspace</h2>
                  <p>
                    Real invitations and team access changes are disabled in the
                    demo. All production actions are available to you as a demo
                    administrator.
                  </p>
                  <a className="button primary" href="/login?mode=signup">
                    Create your own workspace
                  </a>
                </section>
              ) : (
                <TeamView data={data} refresh={refresh} />
              ))}
            {view === "audit" && data.role === "admin" && (
              <>
                <p className="muted">
                  Permanent history of production changes, inventory movements
                  and team access.
                </p>
                <History data={data} kind="audit" />
              </>
            )}
            {view === "notifications" && (
              <>
                <div className="p-toolbar">
                  <p className="muted">
                    Recent production and delivery updates. Read status is
                    personal to your account.
                  </p>
                  <button
                    className="button"
                    disabled={!data.unreadCount}
                    onClick={async () => {
                      try {
                        await api("notifications", {
                          tenantId: data.tenant.id,
                        });
                        await refresh();
                      } catch (e) {
                        setError(
                          e instanceof Error
                            ? e.message
                            : "Could not mark notifications read.",
                        );
                      }
                    }}
                  >
                    Mark all as read
                  </button>
                </div>
                <div className="p-risk-list">
                  {data.notifications.map((n) => (
                    <article
                      key={n.id}
                      className={`p-notification ${!n.readAt ? "unread" : ""}`}
                    >
                      <div className="p-section-head">
                        <h2>{n.title}</h2>
                        <small>{new Date(n.createdAt).toLocaleString()}</small>
                      </div>
                      <p>{n.message}</p>
                      <div className="p-actions">
                        {n.orderId && (
                          <button
                            className="p-link"
                            onClick={() =>
                              setDialog({ kind: "detail", id: n.orderId! })
                            }
                          >
                            Open order
                          </button>
                        )}
                        {!n.readAt && (
                          <button
                            className="p-link"
                            onClick={async () => {
                              try {
                                await api("notifications", {
                                  tenantId: data.tenant.id,
                                  id: n.id,
                                });
                                await refresh();
                              } catch (e) {
                                setError(
                                  e instanceof Error
                                    ? e.message
                                    : "Could not save read status.",
                                );
                              }
                            }}
                          >
                            Mark as read
                          </button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
                {!data.notifications.length && (
                  <Empty
                    title="You’re up to date"
                    text="New material shortages, production completions and delivery risks appear here."
                  />
                )}
              </>
            )}
            {view === "reports" && (
              <>
                <div className="p-toolbar">
                  <p className="muted">
                    Reports use the current workspace and its recorded
                    production results.
                  </p>
                  <div className="p-actions">
                    <a
                      className="button"
                      href={reportUrl(data.tenant.id, "csv")}
                    >
                      Export orders CSV
                    </a>
                    <a
                      className="button"
                      href={reportUrl(data.tenant.id, "schedule")}
                    >
                      Export schedule CSV
                    </a>
                    <a
                      className="button primary"
                      href={reportUrl(data.tenant.id, "pdf")}
                    >
                      Download PDF report
                    </a>
                  </div>
                </div>
                <div className="p-metrics">
                  <Metric
                    label="Completed orders"
                    value={stats.completed}
                    note="All recorded production"
                  />
                  <Metric
                    label="Units produced"
                    value={stats.throughput.toLocaleString()}
                    note="Completed orders only"
                  />
                  <Metric
                    label="On-time delivery"
                    value={
                      stats.onTimePercent === null
                        ? "No deliveries"
                        : `${stats.onTimePercent}%`
                    }
                    note={`${stats.onTime} of ${stats.delivered} deliveries`}
                  />
                  <Metric
                    label="Recorded production time"
                    value={`${Math.round((stats.productiveMinutes / 60) * 10) / 10}h`}
                    note="Running work sessions; holds excluded"
                  />
                </div>
                <section className="p-panel p-padding">
                  <h2>Planned utilization</h2>
                  <Utilization items={stats.utilization} />
                </section>
                <h2 className="p-section-title">Order outcomes</h2>
                {orderTable}
              </>
            )}
          </div>
        </main>
        {dialog?.kind === "order" && (
          <OrderForm
            {...props}
            order={data.orders.find((o) => o.id === dialog.id)}
          />
        )}
        {dialog?.kind === "machine" && (
          <MachineForm
            {...props}
            machine={data.machines.find((o) => o.id === dialog.id)}
          />
        )}
        {dialog?.kind === "material" && (
          <MaterialForm
            {...props}
            material={data.materials.find((o) => o.id === dialog.id)}
          />
        )}
        {dialog?.kind === "product" && (
          <ProductForm
            {...props}
            product={data.products.find((o) => o.id === dialog.id)}
          />
        )}
        {dialog?.kind === "receipt" && (
          <ReceiptForm
            {...props}
            receipt={data.receipts.find((o) => o.id === dialog.id)}
          />
        )}
        {dialog?.kind === "settings" && <SettingsForm {...props} />}
        {dialog?.kind === "import" && <ImportOrders {...props} />}
        {dialog?.kind === "unit" && (
          <FormDialog
            key={dialog?.revision}
            title="Add a manufacturing workspace"
            close={() => setDialog(null)}
            submit={createUnit}
          >
            {unitForm}
          </FormDialog>
        )}
        {dialog?.kind === "confirm" && (
          <FormDialog
            key={dialog?.revision}
            title={dialog.title!}
            close={() => setDialog(null)}
            submit={async () => save(dialog.action!, dialog.revision)}
          >
            <p>{dialog.message}</p>
          </FormDialog>
        )}
        {dialog?.kind === "adjust" && (
          <FormDialog
            key={dialog?.revision}
            title="Stock adjustment"
            close={() => setDialog(null)}
            submit={async (f) =>
              save(
                {
                  action: "inventory.adjust",
                  materialId: dialog.id!,
                  stockMilli: Math.round(Number(f.get("quantity")) * 1000),
                  reason: String(f.get("reason")),
                },
                dialog.revision,
              )
            }
          >
            <h3>{data.materials.find((m) => m.id === dialog.id)?.name}</h3>
            <Field
              label={`New on-hand quantity (${data.materials.find((m) => m.id === dialog.id)?.unit})`}
            >
              <input
                name="quantity"
                type="number"
                min={0}
                max={1e9}
                step="0.001"
                required
                defaultValue={
                  (data.materials.find((m) => m.id === dialog.id)?.stockMilli ??
                    0) / 1000
                }
              />
            </Field>
            <Field label="Reason">
              <input
                name="reason"
                required
                maxLength={120}
                placeholder="e.g. Physical stock count"
              />
            </Field>
            <p className="muted">
              The difference is recorded in the stock ledger. Shortages update
              the production plan.
            </p>
          </FormDialog>
        )}
        {dialog?.kind === "stage" && selectedOrder && (
          <FormDialog
            key={dialog?.revision}
            title={
              dialog.transition === "hold"
                ? "Put production on hold"
                : "Update production progress"
            }
            close={() => setDialog(null)}
            submit={async (f) =>
              save(
                {
                  action: "stage.update",
                  orderId: selectedOrder.id,
                  stageId: dialog.id!,
                  transition: dialog.transition!,
                  ...(dialog.transition === "hold"
                    ? { reason: String(f.get("reason")) }
                    : {
                        completedQuantity: Number(f.get("quantity")),
                        setupCompleted: f.get("setup") === "on",
                      }),
                },
                dialog.revision,
              )
            }
          >
            {dialog.transition === "hold" ? (
              <Field label="Reason for the hold">
                <textarea name="reason" required maxLength={500} />
              </Field>
            ) : (
              <>
                <Field label="Completed units">
                  <input
                    name="quantity"
                    type="number"
                    min={
                      selectedOrder.stages.find((s) => s.id === dialog.id)
                        ?.completedQuantity ?? 0
                    }
                    max={selectedOrder.quantity - 1}
                    required
                    defaultValue={
                      selectedOrder.stages.find((s) => s.id === dialog.id)
                        ?.completedQuantity ?? 0
                    }
                  />
                </Field>
                <label className="p-check">
                  <input
                    type="checkbox"
                    name="setup"
                    defaultChecked={
                      selectedOrder.stages.find((s) => s.id === dialog.id)
                        ?.setupCompleted
                    }
                  />
                  Setup is complete
                </label>
                <p className="muted">
                  Use Complete stage when the full quantity has finished.
                </p>
              </>
            )}
          </FormDialog>
        )}
        {dialog?.kind === "detail" && selectedOrder && (
          <Modal
            title={`${selectedOrder.number} · ${selectedOrder.productName}`}
            onClose={() => setDialog(null)}
            drawer
          >
            <div className="p-padding">
              <div className="p-section-head">
                <Status value={orderStatus(selectedOrder)} />
                <PriorityBadge priority={selectedOrder.priority} />
              </div>
              <dl className="p-detail-grid">
                <div>
                  <dt>Customer</dt>
                  <dd>{selectedOrder.customer}</dd>
                </div>
                <div>
                  <dt>Quantity</dt>
                  <dd>{selectedOrder.quantity.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Delivery deadline</dt>
                  <dd>{fmtDate(selectedOrder.deadline)}</dd>
                </div>
                <div>
                  <dt>Materials</dt>
                  <dd>
                    {selectedOrder.materialsIssued
                      ? "Issued to production"
                      : "Not issued"}
                  </dd>
                </div>
              </dl>
              <h3>Production stages</h3>
              <StageList
                order={selectedOrder}
                data={data}
                allowed={floorAccess && !busy}
                perform={perform}
                setDialog={setDialog}
              />
              <h3 className="p-section-title">Material requirements</h3>
              <ul className="p-detail-list">
                {selectedOrder.bom.map((line) => {
                  const m = data.materials.find(
                    (m) => m.id === line.materialId,
                  );
                  return (
                    <li key={line.materialId}>
                      <span>{m?.name}</span>
                      <strong>
                        {quantity(
                          line.quantityMilliPerUnit * selectedOrder.quantity,
                          m?.unit ?? "",
                        )}
                      </strong>
                    </li>
                  );
                })}
              </ul>
              <h3 className="p-section-title">Delivery</h3>
              <p>
                {selectedOrder.deliveredAt
                  ? `Delivered ${new Date(selectedOrder.deliveredAt).toLocaleString()}`
                  : selectedOrder.completedAt
                    ? "Production completed. Awaiting delivery confirmation."
                    : "Production is not yet complete."}
              </p>
              {data.plan?.orders
                .find((o) => o.orderId === selectedOrder.id)
                ?.risks.map((risk) => (
                  <p key={risk.id} className="p-error">
                    {risk.message}
                  </p>
                ))}
              {orderAccess && (
                <div className="p-form-actions">
                  {!selectedOrder.materialsIssued &&
                    !selectedOrder.cancelledAt && (
                      <>
                        <button
                          className="button"
                          onClick={() =>
                            setDialog({ kind: "order", id: selectedOrder.id })
                          }
                        >
                          Edit order
                        </button>
                        <button
                          className="button"
                          onClick={() =>
                            setDialog({
                              kind: "confirm",
                              title: `Cancel ${selectedOrder.number}`,
                              message:
                                "This unstarted order will be removed from the production schedule. Its history will remain available.",
                              action: {
                                action: "order.cancel",
                                orderId: selectedOrder.id,
                              },
                            })
                          }
                        >
                          Cancel order
                        </button>
                      </>
                    )}
                  {selectedOrder.completedAt && !selectedOrder.deliveredAt && (
                    <button
                      className="button primary"
                      onClick={() =>
                        setDialog({
                          kind: "confirm",
                          title: "Confirm delivery",
                          message:
                            "Record this order as delivered now? This date is used for on-time delivery reporting.",
                          action: {
                            action: "order.deliver",
                            orderId: selectedOrder.id,
                          },
                        })
                      }
                    >
                      Confirm delivery
                    </button>
                  )}
                </div>
              )}
            </div>
          </Modal>
        )}
        {dialog?.kind === "optimize" && (
          <Optimization
            data={data}
            save={(action) => save(action, dialog.revision)}
            close={() => setDialog(null)}
          />
        )}
      </div>
    </DraftRecovery.Provider>
  );
}
function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: string | number;
  note: string;
}) {
  return (
    <article className="p-metric">
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="p-empty">
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}
function Utilization({
  items,
}: {
  items: ReturnType<typeof analytics>["utilization"];
}) {
  return (
    <div className="p-utilization">
      {items.map((m) => (
        <div key={m.id}>
          <div>
            <strong>{m.name}</strong>
            <span>{m.percent}%</span>
          </div>
          <progress
            aria-label={`${m.name} planned utilization`}
            max={100}
            value={m.percent}
          />
          <small>
            {Math.round((m.planned / 60) * 10) / 10} /{" "}
            {Math.round((m.available / 60) * 10) / 10} hours
          </small>
        </div>
      ))}
      {!items.length && (
        <p className="p-empty">Add work centers to see capacity.</p>
      )}
    </div>
  );
}
function StageList({
  order,
  data,
  allowed,
  perform,
  setDialog,
}: {
  order: ProductionOrder;
  data: Workspace;
  allowed: boolean;
  perform: (action: Action) => Promise<void>;
  setDialog: (dialog: Dialog) => void;
}) {
  return (
    <ol className="p-stages">
      {order.stages.map((stage, i) => (
        <li key={stage.id}>
          <div className="p-stage-number">
            {stage.status === "completed" ? "✓" : i + 1}
          </div>
          <div className="p-stage-content">
            <div className="p-section-head">
              <strong>{stage.name}</strong>
              <Status value={stage.status} />
            </div>
            <small>
              {data.machines.find((m) => m.id === stage.machineId)?.name} ·{" "}
              {stage.completedQuantity}/{order.quantity} units
            </small>
            <p className="p-stage-duration">
              Planned duration:{" "}
              <strong>
                {stage.setupMinutes + order.quantity * stage.minutesPerUnit} min
              </strong>
              <small className="muted">
                {stage.setupMinutes} min setup + {order.quantity} ×{" "}
                {stage.minutesPerUnit} min per unit
              </small>
            </p>
            {stage.holdReason && <p className="p-danger">{stage.holdReason}</p>}
            {allowed && !order.cancelledAt && !order.completedAt && (
              <div className="p-actions">
                {stage.status === "queued" && (
                  <button
                    className="button"
                    disabled={order.stages
                      .slice(0, i)
                      .some((s) => s.status !== "completed")}
                    onClick={() =>
                      void perform({
                        action: "stage.update",
                        orderId: order.id,
                        stageId: stage.id,
                        transition: "start",
                      })
                    }
                  >
                    Start stage
                  </button>
                )}
                {stage.status === "on_hold" && (
                  <button
                    className="button"
                    onClick={() =>
                      void perform({
                        action: "stage.update",
                        orderId: order.id,
                        stageId: stage.id,
                        transition: "resume",
                      })
                    }
                  >
                    Resume
                  </button>
                )}
                {stage.status === "in_progress" && (
                  <>
                    <button
                      className="button"
                      onClick={() =>
                        setDialog({
                          kind: "stage",
                          orderId: order.id,
                          id: stage.id,
                          transition: "progress",
                        })
                      }
                    >
                      Update progress
                    </button>
                    <button
                      className="button"
                      onClick={() =>
                        setDialog({
                          kind: "stage",
                          orderId: order.id,
                          id: stage.id,
                          transition: "hold",
                        })
                      }
                    >
                      Put on hold
                    </button>
                    <button
                      className="button primary"
                      onClick={() =>
                        setDialog({
                          kind: "confirm",
                          title: `Complete ${stage.name}`,
                          message: `Confirm all ${order.quantity} units have completed this stage. The next stage can then begin.`,
                          action: {
                            action: "stage.update",
                            orderId: order.id,
                            stageId: stage.id,
                            transition: "complete",
                          },
                        })
                      }
                    >
                      Complete stage
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
function History({
  data,
  kind,
}: {
  data: Workspace;
  kind: "audit" | "inventory";
}) {
  const [items, setItems] = useState<Array<AuditEntry | InventoryMovement>>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<{
      items: Array<AuditEntry | InventoryMovement>;
      cursor: string | null;
    }>(`activity?tenantId=${data.tenant.id}&kind=${kind}`)
      .then((r) => {
        if (active) {
          setItems(r.items);
          setCursor(r.cursor);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [data.tenant.id, data.tenant.revision, kind]);
  return (
    <div className="p-panel p-padding">
      {error && <p className="p-error">{error}</p>}
      {items.map((item) => (
        <details className="p-history-item" key={item.id}>
          <summary>
            <time>{new Date(item.createdAt).toLocaleString()}</time>
            {"action" in item ? (
              <>
                <strong>{item.action}</strong>
                <span>{item.actorName}</span>
              </>
            ) : (
              <>
                <strong>
                  {data.materials.find((m) => m.id === item.materialId)?.name}
                </strong>
                <span>
                  {item.deltaMilli > 0 ? "+" : ""}
                  {quantity(
                    item.deltaMilli,
                    data.materials.find((m) => m.id === item.materialId)
                      ?.unit ?? "",
                  )}{" "}
                  · {item.reason}
                </span>
              </>
            )}
          </summary>
          {"hasFullDetails" in item && item.hasFullDetails ? (
            <button
              className="button"
              onClick={async () => {
                try {
                  const result = await api<{ item: AuditEntry }>(
                    `activity?tenantId=${data.tenant.id}&kind=audit&id=${item.id}`,
                  );
                  setItems((current) =>
                    current.map((entry) =>
                      entry.id === item.id ? result.item : entry,
                    ),
                  );
                } catch (e) {
                  setError(
                    e instanceof Error
                      ? e.message
                      : "Could not load the full entry.",
                  );
                }
              }}
            >
              Load full change details
            </button>
          ) : (
            <pre>{JSON.stringify(item, null, 2)}</pre>
          )}
        </details>
      ))}
      {!items.length && <p className="p-empty">No history yet.</p>}
      {cursor && (
        <button
          className="button"
          onClick={async () => {
            try {
              const r = await api<{
                items: Array<AuditEntry | InventoryMovement>;
                cursor: string | null;
              }>(
                `activity?tenantId=${data.tenant.id}&kind=${kind}&cursor=${encodeURIComponent(cursor)}`,
              );
              setItems([...items, ...r.items]);
              setCursor(r.cursor);
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Could not load history.",
              );
            }
          }}
        >
          Load older entries
        </button>
      )}
    </div>
  );
}
type Candidate = {
  strategy: "priority" | "deadline" | "shortest" | "material";
  label: string;
  score: {
    lateOrders: number;
    lateDays: number;
    blockedOrders: number;
    plannedMinutes: number;
  };
  recommended: boolean;
};
function Optimization({
  data,
  save,
  close,
}: {
  data: Workspace;
  save: (action: Action) => Promise<void>;
  close: () => void;
}) {
  const [result, setResult] = useState<{
      candidates: Candidate[];
      explanation: string;
      source: string;
    } | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<{ candidates: Candidate[]; explanation: string; source: string }>(
      "optimize",
      { tenantId: data.tenant.id, revision: data.tenant.revision },
    )
      .then((r) => {
        if (active) setResult(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [data.tenant.id, data.tenant.revision]);
  return (
    <FormDialog
      title="Compare production schedules"
      close={close}
      submit={async (f) => {
        if (!result) throw new Error("Wait for schedule comparison to finish.");
        await save({
          action: "plan.generate",
          strategy: String(f.get("strategy")) as Candidate["strategy"],
        });
      }}
    >
      <p className="muted">
        Compare feasible sequences while retaining started work and planner
        locks. Review the tradeoffs before applying.
      </p>
      {error && <p className="p-error">{error}</p>}
      {!result && !error && <p role="status">Checking candidate schedules…</p>}
      {result && (
        <>
          <p className="p-success">{result.explanation}</p>
          <small>{result.source}</small>
          <Field label="Schedule strategy">
            <select
              name="strategy"
              defaultValue={
                result.candidates.find((c) => c.recommended)?.strategy
              }
            >
              {result.candidates.map((c) => (
                <option key={c.strategy} value={c.strategy}>
                  {c.label}
                  {c.recommended ? " (recommended)" : ""}
                </option>
              ))}
            </select>
          </Field>
          <div className="p-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th>Late orders</th>
                  <th>Unplanned orders</th>
                  <th>Late days</th>
                </tr>
              </thead>
              <tbody>
                {result.candidates.map((c) => (
                  <tr key={c.strategy}>
                    <td>{c.label}</td>
                    <td>{c.score.lateOrders}</td>
                    <td>{c.score.blockedOrders}</td>
                    <td>{c.score.lateDays}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </FormDialog>
  );
}
