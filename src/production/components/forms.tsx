"use client";
import {
  useState,
  createContext,
  useContext,
  useId,
  Children,
  isValidElement,
  cloneElement,
  type ReactElement,
  type ReactNode,
  type FormEvent,
} from "react";
import { Modal } from "../../components/ui";
import { localDay, addDays } from "../dates";
import type { Action } from "../validation";
import type {
  Workspace,
  Product,
  Material,
  ProductionOrder,
  Receipt,
} from "../types";
import type { Machine } from "../../domain/types";

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const id = useId();
  return (
    <label className="field">
      <span id={id}>{label}</span>
      {Children.map(children, (child) =>
        isValidElement(child) &&
        ["input", "select", "textarea"].includes(String(child.type))
          ? cloneElement(child as ReactElement<Record<string, unknown>>, {
              "aria-labelledby": id,
              "aria-describedby": hint ? `${id}-hint` : undefined,
            })
          : child,
      )}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </label>
  );
}
export const DraftRecovery = createContext<(() => void) | null>(null);
export function FormDialog({
  title,
  close,
  submit,
  children,
  reload,
}: {
  title: string;
  close: () => void;
  submit: (form: FormData) => Promise<void>;
  children: ReactNode;
  reload?: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const inheritedRecovery = useContext(DraftRecovery),
    recover = reload ?? inheritedRecovery;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await submit(form);
      close();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not save. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={title}
      onClose={() => {
        if (!busy) close();
      }}
    >
      <form className="platform p-form" onSubmit={save}>
        <fieldset disabled={busy}>{children}</fieldset>
        {error && (
          <p className="p-error" role="alert">
            {error}
          </p>
        )}
        {error && recover && /changed/i.test(error) && (
          <div>
            <p className="muted">
              Your draft has not overwritten anyone’s changes. Load the latest
              values to review them and start a new edit.
            </p>
            <button type="button" className="button" onClick={recover}>
              Load latest values (discard this draft)
            </button>
          </div>
        )}
        <div className="p-form-actions">
          <button
            type="button"
            className="button"
            onClick={close}
            disabled={busy}
          >
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
const str = (f: FormData, key: string) => String(f.get(key) ?? "").trim();
const num = (f: FormData, key: string) => Number(f.get(key));
const amount = (f: FormData, key: string) => Math.round(num(f, key) * 1000);
export function TimeField({
  label,
  accessibleLabel = label,
  value,
  change,
  allowEndOfDay = false,
}: {
  label: string;
  accessibleLabel?: string;
  value: number;
  change: (value: number) => void;
  allowEndOfDay?: boolean;
}) {
  const hour = Math.floor(value / 60),
    minute = value % 60;
  return (
    <fieldset className="p-time-field" aria-label={accessibleLabel}>
      <legend>{label}</legend>
      <div className="p-time-controls">
        <select
          aria-label={`${accessibleLabel} hours`}
          value={hour}
          onChange={(e) => {
            const nextHour = Number(e.target.value);
            change(nextHour === 24 ? 1440 : nextHour * 60 + minute);
          }}
        >
          {Array.from({ length: allowEndOfDay ? 25 : 24 }, (_, n) => (
            <option key={n} value={n}>
              {String(n).padStart(2, "0")}
            </option>
          ))}
        </select>
        <span aria-hidden="true">:</span>
        <select
          aria-label={`${accessibleLabel} minutes`}
          value={minute}
          disabled={hour === 24}
          onChange={(e) => change(hour * 60 + Number(e.target.value))}
        >
          {Array.from({ length: hour === 24 ? 1 : 60 }, (_, n) => (
            <option key={n} value={n}>
              {String(n).padStart(2, "0")}
            </option>
          ))}
        </select>
      </div>
    </fieldset>
  );
}
type Props = {
  data: Workspace;
  save: (action: Action) => Promise<void>;
  close: () => void;
};

export function OrderForm({
  data,
  save,
  close,
  order,
}: Props & { order?: ProductionOrder }) {
  return (
    <FormDialog
      title={order ? `Edit ${order.number}` : "Create order"}
      close={close}
      submit={async (f) =>
        save({
          action: "order.save",
          value: {
            id: order?.id,
            number: str(f, "number"),
            customer: str(f, "customer"),
            productId: str(f, "product"),
            quantity: num(f, "quantity"),
            priority: str(f, "priority") as ProductionOrder["priority"],
            deadline: str(f, "deadline"),
          },
        })
      }
    >
      <p className="muted">
        The schedule checks this order against stock, work-center capacity and
        its delivery deadline.
      </p>
      <div className="p-form-grid">
        <Field label="Order reference">
          <input
            name="number"
            required
            maxLength={40}
            defaultValue={
              order?.number ??
              `ORD-${String(data.orders.length + 1).padStart(4, "0")}`
            }
          />
        </Field>
        <Field label="Customer">
          <input
            name="customer"
            required
            maxLength={120}
            defaultValue={order?.customer}
          />
        </Field>
      </div>
      <Field label="Product">
        <select name="product" required defaultValue={order?.productId ?? ""}>
          <option value="" disabled>
            Select a product
          </option>
          {data.products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.sku} · {p.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="p-form-grid">
        <Field label="Quantity">
          <input
            type="number"
            name="quantity"
            required
            min={1}
            max={100000}
            step={1}
            defaultValue={order?.quantity ?? 100}
          />
        </Field>
        <Field label="Priority">
          <select name="priority" defaultValue={order?.priority ?? "normal"}>
            {["urgent", "high", "normal", "low"].map((p) => (
              <option key={p} value={p}>
                {p[0].toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Delivery deadline">
          <input
            type="date"
            name="deadline"
            required
            defaultValue={
              order?.deadline ?? addDays(localDay(data.tenant.timeZone), 7)
            }
          />
        </Field>
      </div>
      <p className="muted">
        The product’s current materials and production stages are saved with the
        order.
      </p>
    </FormDialog>
  );
}

export function MaterialForm({
  save,
  close,
  material,
}: Props & { material?: Material }) {
  return (
    <FormDialog
      title={material ? "Edit material" : "Add material"}
      close={close}
      submit={async (f) =>
        save({
          action: "material.save",
          value: {
            id: material?.id,
            name: str(f, "name"),
            code: str(f, "code"),
            unit: (material?.unit ?? str(f, "unit")) as Material["unit"],
            stockMilli: material?.stockMilli ?? amount(f, "stock"),
            reorderMilli: amount(f, "reorder"),
            leadTimeDays: num(f, "lead"),
          },
        })
      }
    >
      <div className="p-form-grid">
        <Field label="Material code">
          <input
            name="code"
            required
            maxLength={40}
            defaultValue={material?.code}
          />
        </Field>
        <Field label="Material name">
          <input
            name="name"
            required
            maxLength={120}
            defaultValue={material?.name}
          />
        </Field>
      </div>
      <div className="p-form-grid">
        <Field label="Unit">
          <select
            name="unit"
            disabled={!!material}
            defaultValue={material?.unit ?? "kg"}
          >
            {["kg", "pcs", "m", "l"].map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </Field>
        {!material && (
          <Field label="Opening stock">
            <input
              name="stock"
              type="number"
              min={0}
              max={1e9}
              step="0.001"
              required
              defaultValue={0}
            />
          </Field>
        )}
        <Field label="Reorder level">
          <input
            name="reorder"
            type="number"
            min={0}
            max={1e9}
            step="0.001"
            required
            defaultValue={(material?.reorderMilli ?? 0) / 1000}
          />
        </Field>
        <Field label="Supplier lead time (days)">
          <input
            name="lead"
            type="number"
            min={0}
            max={730}
            step={1}
            required
            defaultValue={material?.leadTimeDays ?? 7}
          />
        </Field>
      </div>
    </FormDialog>
  );
}

export function ReceiptForm({
  data,
  save,
  close,
  receipt,
}: Props & { receipt?: Receipt }) {
  return (
    <FormDialog
      title={receipt ? "Edit expected receipt" : "Expected material receipt"}
      close={close}
      submit={async (f) =>
        save({
          action: "receipt.save",
          value: {
            id: receipt?.id,
            materialId: str(f, "material"),
            reference: str(f, "reference"),
            quantityMilli: amount(f, "quantity"),
            expectedDate: str(f, "date"),
          },
        })
      }
    >
      <Field label="Material">
        <select name="material" defaultValue={receipt?.materialId} required>
          {data.materials.map((m) => (
            <option value={m.id} key={m.id}>
              {m.code} · {m.name} ({m.unit})
            </option>
          ))}
        </select>
      </Field>
      <Field label="Purchase reference">
        <input
          name="reference"
          required
          maxLength={120}
          defaultValue={receipt?.reference}
        />
      </Field>
      <div className="p-form-grid">
        <Field label="Expected quantity">
          <input
            name="quantity"
            type="number"
            min="0.001"
            max={1e9}
            step="0.001"
            required
            defaultValue={(receipt?.quantityMilli ?? 100000) / 1000}
          />
        </Field>
        <Field label="Expected arrival">
          <input
            name="date"
            type="date"
            required
            defaultValue={
              receipt?.expectedDate ?? localDay(data.tenant.timeZone)
            }
          />
        </Field>
      </div>
      <p className="muted">
        The plan can use the expected arrival date. On-hand stock changes when
        you confirm receipt.
      </p>
    </FormDialog>
  );
}

export function ProductForm({
  data,
  save,
  close,
  product,
}: Props & { product?: Product }) {
  const [bom, setBom] = useState(
    product?.bom ?? [
      { materialId: data.materials[0]?.id ?? "", quantityMilliPerUnit: 1000 },
    ],
  );
  const [routing, setRouting] = useState(
    product?.routing ?? [
      {
        id: crypto.randomUUID(),
        name: "Production",
        machineId: data.machines[0]?.id ?? "",
        minutesPerUnit: 1,
        setupMinutes: 0,
      },
    ],
  );
  return (
    <FormDialog
      title={product ? "Edit product" : "Add product"}
      close={close}
      submit={async (f) =>
        save({
          action: "product.save",
          value: {
            id: product?.id,
            sku: str(f, "sku"),
            name: str(f, "name"),
            bom,
            routing,
          },
        })
      }
    >
      <div className="p-form-grid">
        <Field label="Product SKU">
          <input
            name="sku"
            required
            maxLength={40}
            defaultValue={product?.sku}
          />
        </Field>
        <Field label="Product name">
          <input
            name="name"
            required
            maxLength={120}
            defaultValue={product?.name}
          />
        </Field>
      </div>
      <h3>Materials per finished unit</h3>
      <p className="muted">
        Include expected production waste in these quantities.
      </p>
      {bom.map((line, i) => (
        <div className="p-line" key={i}>
          <Field label="Material">
            <select
              required
              value={line.materialId}
              onChange={(e) =>
                setBom(
                  bom.map((b, j) =>
                    j === i ? { ...b, materialId: e.target.value } : b,
                  ),
                )
              }
            >
              {data.materials.map((m) => (
                <option value={m.id} key={m.id}>
                  {m.name} ({m.unit})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Quantity per unit">
            <input
              type="number"
              min="0.001"
              max={1e6}
              step="0.001"
              required
              value={line.quantityMilliPerUnit / 1000}
              onChange={(e) =>
                setBom(
                  bom.map((b, j) =>
                    j === i
                      ? {
                          ...b,
                          quantityMilliPerUnit: Math.round(
                            Number(e.target.value) * 1000,
                          ),
                        }
                      : b,
                  ),
                )
              }
            />
          </Field>
          <button
            type="button"
            className="button"
            disabled={bom.length === 1}
            onClick={() => setBom(bom.filter((_, j) => j !== i))}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="button"
        disabled={bom.length >= 50}
        onClick={() =>
          setBom([
            ...bom,
            {
              materialId:
                data.materials.find(
                  (m) => !bom.some((b) => b.materialId === m.id),
                )?.id ?? "",
              quantityMilliPerUnit: 1000,
            },
          ])
        }
      >
        Add material
      </button>
      <h3 className="p-section-title">Production stages</h3>
      <p className="muted">
        Stages run in this order. A stage starts after the previous one
        finishes.
      </p>
      {routing.map((step, i) => (
        <div className="p-stage-editor" key={step.id}>
          <strong>Stage {i + 1}</strong>
          <div className="p-form-grid">
            <Field label="Stage name">
              <input
                required
                maxLength={120}
                value={step.name}
                onChange={(e) =>
                  setRouting(
                    routing.map((s, j) =>
                      j === i ? { ...s, name: e.target.value } : s,
                    ),
                  )
                }
              />
            </Field>
            <Field label="Work center">
              <select
                required
                value={step.machineId}
                onChange={(e) =>
                  setRouting(
                    routing.map((s, j) =>
                      j === i ? { ...s, machineId: e.target.value } : s,
                    ),
                  )
                }
              >
                {data.machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Minutes per unit">
              <input
                type="number"
                min={1}
                max={10080}
                required
                value={step.minutesPerUnit}
                onChange={(e) =>
                  setRouting(
                    routing.map((s, j) =>
                      j === i
                        ? { ...s, minutesPerUnit: Number(e.target.value) }
                        : s,
                    ),
                  )
                }
              />
            </Field>
            <Field label="Setup minutes">
              <input
                type="number"
                min={0}
                max={10080}
                required
                value={step.setupMinutes}
                onChange={(e) =>
                  setRouting(
                    routing.map((s, j) =>
                      j === i
                        ? { ...s, setupMinutes: Number(e.target.value) }
                        : s,
                    ),
                  )
                }
              />
            </Field>
          </div>
          <div className="p-actions">
            <button
              type="button"
              className="button"
              disabled={!i}
              onClick={() => {
                const next = [...routing];
                [next[i - 1], next[i]] = [next[i], next[i - 1]];
                setRouting(next);
              }}
            >
              Move up
            </button>
            <button
              type="button"
              className="button"
              disabled={routing.length === 1}
              onClick={() => setRouting(routing.filter((_, j) => j !== i))}
            >
              Remove stage
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="button"
        disabled={routing.length >= 20}
        onClick={() =>
          setRouting([
            ...routing,
            {
              id: crypto.randomUUID(),
              name: "",
              machineId: data.machines[0]?.id ?? "",
              minutesPerUnit: 1,
              setupMinutes: 0,
            },
          ])
        }
      >
        Add stage
      </button>
    </FormDialog>
  );
}

export function MachineForm({
  save,
  close,
  machine,
}: Props & { machine?: Machine }) {
  const [shifts, setShifts] = useState(
    machine?.shifts ??
      [1, 2, 3, 4, 5].map((weekday) => ({
        weekday,
        startMinute: 480,
        endMinute: 1020,
      })),
  );
  const [downtime, setDowntime] = useState(machine?.downtime ?? []);
  const weekdays = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  return (
    <FormDialog
      title={machine ? "Edit work center" : "Add work center"}
      close={close}
      submit={async (f) =>
        save({
          action: "machine.save",
          value: {
            id: machine?.id,
            code: str(f, "code"),
            name: str(f, "name"),
            kind: str(f, "kind"),
            dailyCapacityMinutes: num(f, "capacity"),
            shifts,
            downtime,
          },
        })
      }
    >
      <div className="p-form-grid">
        <Field label="Work-center code">
          <input
            name="code"
            maxLength={40}
            required
            defaultValue={machine?.code}
          />
        </Field>
        <Field label="Name">
          <input
            name="name"
            maxLength={120}
            required
            defaultValue={machine?.name}
          />
        </Field>
        <Field label="Type">
          <input
            name="kind"
            maxLength={120}
            required
            defaultValue={machine?.kind ?? "Production"}
          />
        </Field>
        <Field
          label="Daily capacity (minutes)"
          hint="Caps usable time within the shift calendar."
        >
          <input
            name="capacity"
            type="number"
            min={1}
            max={1440}
            required
            defaultValue={machine?.dailyCapacityMinutes ?? 480}
          />
        </Field>
      </div>
      <h3>Weekly shifts</h3>
      <p className="muted">
        Times use the 24-hour clock. Choose 00:00 for midnight at the start of a
        day and 24:00 for the end. Split overnight shifts at midnight.
      </p>
      {shifts.map((shift, i) => (
        <div className="p-shift-editor" key={i}>
          <Field label="Day">
            <select
              value={shift.weekday}
              onChange={(e) =>
                setShifts(
                  shifts.map((s, j) =>
                    i === j ? { ...s, weekday: Number(e.target.value) } : s,
                  ),
                )
              }
            >
              {weekdays.map((day, j) => (
                <option key={day} value={j}>
                  {day}
                </option>
              ))}
            </select>
          </Field>
          <button
            type="button"
            className="button"
            disabled={shifts.length === 1}
            onClick={() => setShifts(shifts.filter((_, j) => j !== i))}
          >
            Remove
          </button>
          <TimeField
            label="Starts"
            accessibleLabel={`${weekdays[shift.weekday]} shift start ${i + 1}`}
            value={shift.startMinute}
            change={(value) =>
              setShifts(
                shifts.map((s, j) =>
                  i === j ? { ...s, startMinute: value } : s,
                ),
              )
            }
          />
          <TimeField
            label="Ends"
            accessibleLabel={`${weekdays[shift.weekday]} shift end ${i + 1}`}
            allowEndOfDay
            value={shift.endMinute}
            change={(value) =>
              setShifts(
                shifts.map((s, j) =>
                  i === j ? { ...s, endMinute: value } : s,
                ),
              )
            }
          />
        </div>
      ))}
      <button
        className="button"
        type="button"
        disabled={shifts.length >= 28}
        onClick={() =>
          setShifts([
            ...shifts,
            { weekday: 1, startMinute: 480, endMinute: 1020 },
          ])
        }
      >
        Add shift
      </button>
      <h3 className="p-section-title">Planned downtime</h3>
      {downtime.map((item, i) => (
        <div className="p-stage-editor" key={item.id}>
          <div className="p-form-grid">
            <Field label="Date">
              <input
                type="date"
                required
                value={item.date}
                onChange={(e) =>
                  setDowntime(
                    downtime.map((d, j) =>
                      j === i ? { ...d, date: e.target.value } : d,
                    ),
                  )
                }
              />
            </Field>
            <Field label="Reason">
              <input
                required
                maxLength={120}
                value={item.reason}
                onChange={(e) =>
                  setDowntime(
                    downtime.map((d, j) =>
                      j === i ? { ...d, reason: e.target.value } : d,
                    ),
                  )
                }
              />
            </Field>
            <TimeField
              label="Start time"
              accessibleLabel={`Downtime ${i + 1} start`}
              value={item.startMinute}
              change={(value) =>
                setDowntime(
                  downtime.map((d, j) =>
                    j === i ? { ...d, startMinute: value } : d,
                  ),
                )
              }
            />
            <TimeField
              label="End time"
              accessibleLabel={`Downtime ${i + 1} end`}
              allowEndOfDay
              value={item.endMinute}
              change={(value) =>
                setDowntime(
                  downtime.map((d, j) =>
                    j === i ? { ...d, endMinute: value } : d,
                  ),
                )
              }
            />
          </div>
          <button
            className="button"
            type="button"
            onClick={() => setDowntime(downtime.filter((_, j) => j !== i))}
          >
            Remove downtime
          </button>
        </div>
      ))}
      <button
        className="button"
        type="button"
        disabled={downtime.length >= 365}
        onClick={() =>
          setDowntime([
            ...downtime,
            {
              id: crypto.randomUUID(),
              date: new Date().toISOString().slice(0, 10),
              startMinute: 480,
              endMinute: 1020,
              reason: "Maintenance",
            },
          ])
        }
      >
        Add downtime
      </button>
    </FormDialog>
  );
}

export function SettingsForm({ data, save, close }: Props) {
  return (
    <FormDialog
      title="Workspace settings"
      close={close}
      submit={async (f) =>
        save({
          action: "settings.save",
          value: {
            name: str(f, "name"),
            timeZone: str(f, "timezone"),
            horizonDays: num(f, "horizon"),
            dispatchBufferDays: num(f, "buffer"),
          },
        })
      }
    >
      <Field label="Manufacturing unit">
        <input
          name="name"
          required
          maxLength={120}
          defaultValue={data.tenant.name}
        />
      </Field>
      <Field
        label="Plant time zone"
        hint="Schedules and deadlines use this time zone."
      >
        <input
          name="timezone"
          required
          defaultValue={data.tenant.timeZone}
          list="timezones"
        />
        <datalist id="timezones">
          {Intl.supportedValuesOf("timeZone").map((tz) => (
            <option key={tz}>{tz}</option>
          ))}
        </datalist>
      </Field>
      <div className="p-form-grid">
        <Field label="Planning horizon (days)">
          <input
            name="horizon"
            type="number"
            min={7}
            max={90}
            required
            defaultValue={data.tenant.horizonDays}
          />
        </Field>
        <Field label="Dispatch buffer (days)">
          <input
            name="buffer"
            type="number"
            min={0}
            max={14}
            required
            defaultValue={data.tenant.dispatchBufferDays}
          />
        </Field>
      </div>
    </FormDialog>
  );
}
