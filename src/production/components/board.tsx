"use client";
import { useRef, useState, useEffect, useLayoutEffect } from "react";
import {
  ChevronLeft,
  ChevronRight,
  GripVertical,
  LockKeyhole,
  Clock3,
} from "lucide-react";
import { clockTime, fmtDate } from "../../components/ui";
import { FormDialog, Field, TimeField } from "./forms";
import { addDays, dayDifference, localDay, localMinute } from "../dates";
import { dragTime } from "../timeline";
import { workingWindows } from "../../scheduling/constraints";
import type { Allocation, Workspace } from "../types";
import type { Action } from "../validation";
import { can } from "../permissions";

type Selection = Allocation & { revision: number };
type Drag = {
  job: Allocation;
  x: number;
  y: number;
  initialX: number;
  initialY: number;
  scroll: number;
  delta: number;
  date: string;
  startMinute: number;
  pixelsPerMinute: number;
  snap: number;
  track: HTMLElement;
  scroller: HTMLElement;
  revision: number;
};
function dragPosition(d: Drag, x: number, y: number): Drag {
  const delta = x - d.initialX + d.scroller.scrollLeft - d.scroll;
  return {
    ...d,
    x,
    y,
    delta,
    ...dragTime(
      d.job.date,
      d.job.startMinute,
      delta / d.pixelsPerMinute,
      d.snap,
    ),
  };
}
export function ProductionBoard({
  data,
  save,
}: {
  data: Workspace;
  save: (action: Action, revision?: number) => Promise<void>;
}) {
  const [offset, setOffset] = useState(0),
    [view, setView] = useState<"day" | "week">("day"),
    [machineFilter, setMachineFilter] = useState("all"),
    [focusToken, setFocusToken] = useState(0),
    [detail, setDetail] = useState("hours"),
    [snap, setSnap] = useState(5),
    [selected, setSelected] = useState<Selection | null>(null),
    [drag, setDrag] = useState<Drag | null>(null),
    [error, setError] = useState(""),
    [now, setNow] = useState(() => new Date());
  const dragRef = useRef<Drag | null>(null),
    suppressClick = useRef(false),
    saving = useRef(false),
    scrollerRef = useRef<HTMLDivElement>(null);
  const plan = data.plan,
    allowed = can(data.role, "plan");
  const visibleOffset = Math.max(
    0,
    Math.min(offset, plan ? dayDifference(plan.endDate, plan.startDate) : 0),
  );
  const start = plan ? addDays(plan.startDate, visibleOffset) : "";
  const days = view === "day" ? 1 : 7;
  const dates = plan
    ? Array.from(
        { length: Math.min(days, dayDifference(plan.endDate, start) + 1) },
        (_, i) => addDays(start, i),
      )
    : [];
  const dayWidth =
    { days: 360, hours: 2304, "30": 4608, "15": 9216 }[detail] ?? 2304;
  const pixelsPerMinute = dayWidth / 1440;
  const tickStep = { days: 360, hours: 60, "30": 30, "15": 15 }[detail] ?? 60;
  const ticks = Array.from({ length: 1440 / tickStep }, (_, i) => i * tickStep);
  const today = localDay(data.tenant.timeZone, now),
    currentMinute = localMinute(data.tenant.timeZone, now);
  const visibleJobs =
    plan?.allocations.filter(
      (a) =>
        dates.includes(a.date) &&
        (machineFilter === "all" || a.machineId === machineFilter),
    ) ?? [];
  const firstMinute = Math.min(
    ...visibleJobs.filter((a) => a.date === start).map((a) => a.startMinute),
  );
  const shiftStart = Math.min(
    ...data.machines.flatMap((m) =>
      workingWindows(m, start).map((w) => w.start),
    ),
  );
  const focusMinute = Number.isFinite(firstMinute)
    ? firstMinute
    : start === today
      ? currentMinute
      : Number.isFinite(shiftStart)
        ? shiftStart
        : 480;
  const scrollMinute = useRef(0),
    focusRef = useRef(focusMinute);
  const previousView = useRef<{
    start: string;
    view: string;
    focusToken: number;
  } | null>(null);
  useLayoutEffect(() => {
    focusRef.current = focusMinute;
  }, [focusMinute]);
  // Preserve the visible time through zoom, including when the browser clamps a shrinking track.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current,
      previous = previousView.current;
    if (scroller) {
      const sameDates =
        previous &&
        previous.start === start &&
        previous.view === view &&
        previous.focusToken === focusToken;
      scroller.scrollLeft = sameDates
        ? scrollMinute.current * pixelsPerMinute
        : detail === "days"
          ? 0
          : Math.max(
              0,
              (Math.floor(focusRef.current / 60) * 60 - 30) * pixelsPerMinute,
            );
      scrollMinute.current = scroller.scrollLeft / pixelsPerMinute;
    }
    previousView.current = { start, view, focusToken };
  }, [start, view, detail, pixelsPerMinute, focusToken]);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);
  function cancelDrag() {
    dragRef.current = null;
    setDrag(null);
  }
  useEffect(() => {
    const cancel = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dragRef.current) {
        e.preventDefault();
        suppressClick.current = true;
        dragRef.current = null;
        setDrag(null);
      }
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, []);
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    let frame = 0;
    const tick = () => {
      const d = dragRef.current;
      if (!d) return;
      const rect = d.scroller.getBoundingClientRect();
      const velocity =
        d.x < rect.left + 220 ? -10 : d.x > rect.right - 45 ? 10 : 0;
      if (velocity) {
        d.scroller.scrollLeft += velocity;
        const next = dragPosition(d, d.x, d.y);
        dragRef.current = next;
        setDrag(next);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dragging]);
  if (!plan)
    return (
      <div className="p-empty">
        <h2>No schedule yet</h2>
        <p>
          Add your work centers, materials, products and orders. ProdPlan builds
          the schedule as you save.
        </p>
      </div>
    );
  const stageFor = (job: Allocation) =>
    data.orders
      .find((o) => o.id === job.orderId)
      ?.stages.find((s) => s.id === job.stageId);
  const open = (job: Allocation) =>
    setSelected({ ...job, revision: data.tenant.revision });
  async function drop() {
    const d = dragRef.current;
    cancelDrag();
    if (!d || saving.current) return;
    if (Math.abs(d.delta) < 3 && Math.abs(d.y - d.initialY) < 3) {
      // Open on click, after touchend, so the same tap cannot dismiss the new dialog.
      return;
    }
    suppressClick.current = true;
    const bounds = d.track.getBoundingClientRect(),
      viewport = d.scroller.getBoundingClientRect();
    if (
      d.y <
        Math.max(
          bounds.top,
          viewport.top +
            (d.scroller.querySelector(".p-board-header")?.clientHeight ?? 74),
        ) ||
      d.y > Math.min(bounds.bottom, viewport.bottom) ||
      d.x < viewport.left + 180 ||
      d.x > viewport.right
    ) {
      setError(
        "Drop the segment on the timeline in its current work-center row.",
      );
      return;
    }
    if (!dates.includes(d.date)) {
      setError(
        "Choose a time within the displayed dates, or switch to Week to move across days.",
      );
      return;
    }
    if (d.date === d.job.date && d.startMinute === d.job.startMinute) return;
    saving.current = true;
    setError("");
    try {
      await save(
        {
          action: "plan.move",
          allocationId: d.job.id,
          date: d.date,
          startMinute: d.startMinute,
          locked: true,
        },
        d.revision,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not move this segment.");
    } finally {
      saving.current = false;
    }
  }
  return (
    <>
      <div className="p-calendar-toolbar">
        <div className="p-actions">
          <div
            className="p-view-switch"
            role="group"
            aria-label="Timeline view"
          >
            <button
              type="button"
              aria-pressed={view === "day"}
              onClick={() => {
                setView("day");
                setDetail("hours");
              }}
            >
              Day
            </button>
            <button
              type="button"
              aria-pressed={view === "week"}
              onClick={() => {
                setView("week");
                setDetail("days");
              }}
            >
              Week
            </button>
          </div>
          <button
            className="button"
            aria-label={view === "day" ? "Previous day" : "Previous seven days"}
            disabled={!visibleOffset}
            onClick={() => setOffset(Math.max(0, visibleOffset - days))}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            className="button"
            onClick={() => {
              setOffset(0);
              setFocusToken((n) => n + 1);
            }}
          >
            Today
          </button>
          <button
            className="button"
            aria-label={view === "day" ? "Next day" : "Next seven days"}
            disabled={addDays(start, days) > plan.endDate}
            onClick={() => setOffset(visibleOffset + days)}
          >
            <ChevronRight size={16} />
          </button>
          <input
            className="p-calendar-date"
            type="date"
            aria-label="Calendar date"
            min={plan.startDate}
            max={plan.endDate}
            value={start}
            onChange={(e) => {
              if (
                e.target.value >= plan.startDate &&
                e.target.value <= plan.endDate
              )
                setOffset(dayDifference(e.target.value, plan.startDate));
            }}
          />
        </div>
        <div className="p-calendar-options">
          <label>
            Work center
            <select
              aria-label="Work center filter"
              value={machineFilter}
              onChange={(e) => setMachineFilter(e.target.value)}
            >
              <option value="all">All work centers</option>
              {data.machines.map((m) => (
                <option value={m.id} key={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Zoom
            <select
              aria-label="Timeline zoom"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
            >
              <option value="days">Days</option>
              <option value="hours">Hours</option>
              <option value="30">30 minutes</option>
              <option value="15">15 minutes</option>
            </select>
          </label>
          {allowed && (
            <label>
              Drag step
              <select
                aria-label="Drag step"
                value={snap}
                onChange={(e) => setSnap(Number(e.target.value))}
              >
                <option value={1}>1 minute</option>
                <option value={5}>5 minutes</option>
                <option value={15}>15 minutes</option>
              </select>
            </label>
          )}
        </div>
      </div>
      <div className="p-calendar-caption">
        <strong>
          {view === "day"
            ? fmtDate(start, {
                weekday: "long",
                month: "short",
                day: "numeric",
              })
            : `${fmtDate(start)} to ${fmtDate(dates.at(-1)!)}`}
        </strong>
        <span>
          <Clock3 size={14} />
          {data.tenant.timeZone} · 24-hour clock
        </span>
      </div>
      <p className="p-board-help muted">
        {allowed
          ? `Work centers are rows. Drag within a row in ${snap}-minute steps, or click a task to set its date and exact start time.`
          : "Select a segment to see its exact production times."}
      </p>
      {error && (
        <p className="p-error" role="alert">
          {error}
        </p>
      )}
      {drag && (
        <p className="p-drag-notice" role="status">
          Move to {fmtDate(drag.date)} at{" "}
          <strong>{clockTime(drag.startMinute)}</strong> · {drag.job.minutes}{" "}
          min. Capacity, materials and stage order will be checked. Escape
          cancels.
        </p>
      )}
      <div
        className={`p-board-scroll p-calendar-${view}`}
        ref={scrollerRef}
        onScroll={(e) => {
          scrollMinute.current = e.currentTarget.scrollLeft / pixelsPerMinute;
        }}
        role="region"
        aria-label="Production schedule"
        tabIndex={0}
      >
        <div
          className="p-board"
          style={{ width: 180 + dates.length * dayWidth }}
        >
          <div className="p-board-header">
            <div className="p-machine-label">
              Work center
              <small>
                {view === "day" ? "Daily production" : "Weekly production"}
              </small>
            </div>
            {dates.map((date) => (
              <div
                className="p-time-day"
                key={date}
                style={{ width: dayWidth }}
              >
                <div className="p-time-date">
                  <span>
                    {fmtDate(date, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
                <div className="p-time-ruler">
                  {ticks.map((minute) => (
                    <span
                      key={minute}
                      data-timeline-minute={minute}
                      style={{
                        left: minute * pixelsPerMinute,
                        width: tickStep * pixelsPerMinute,
                      }}
                    >
                      {clockTime(minute)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {data.machines
            .filter((m) => machineFilter === "all" || m.id === machineFilter)
            .map((machine) => {
              const jobs = visibleJobs
                .filter((a) => a.machineId === machine.id)
                .sort(
                  (a, b) =>
                    a.date.localeCompare(b.date) ||
                    a.startMinute - b.startMinute,
                );
              const laneEnds: number[] = [];
              const segments = jobs.map((job) => {
                const left =
                  (dayDifference(job.date, start) * 1440 + job.startMinute) *
                  pixelsPerMinute;
                const durationWidth = Math.max(
                  2,
                  job.minutes * pixelsPerMinute,
                );
                const width = Math.max(160, durationWidth);
                let lane = laneEnds.findIndex((end) => end + 4 <= left);
                if (lane < 0) lane = laneEnds.length;
                laneEnds[lane] = left + width;
                return { job, left, width, lane, durationWidth };
              });
              return (
                <div
                  className="p-board-row"
                  key={machine.id}
                  data-work-center={machine.id}
                  style={{
                    minHeight: Math.max(118, 34 + laneEnds.length * 84),
                  }}
                >
                  <div className="p-machine-label">
                    <strong>{machine.name}</strong>
                    <small>{machine.code}</small>
                    <small>
                      {jobs.reduce((n, a) => n + a.minutes, 0)} min planned
                    </small>
                  </div>
                  <div
                    className="p-track"
                    style={{ width: dates.length * dayWidth }}
                  >
                    {dates.map((date, i) => {
                      const windows = workingWindows(machine, date);
                      return (
                        <div
                          key={date}
                          data-schedule-day={date}
                          className="p-day-cell p-calendar-day"
                          style={{ left: i * dayWidth, width: dayWidth }}
                        >
                          {windows.map((w, j) => (
                            <div
                              className="p-working-window"
                              key={j}
                              title={`Available ${clockTime(w.start)} to ${clockTime(w.end)}`}
                              style={{
                                left: w.start * pixelsPerMinute,
                                width: (w.end - w.start) * pixelsPerMinute,
                              }}
                            />
                          ))}
                          {!windows.length && <span>No available shift</span>}
                          {ticks.map((minute) => (
                            <div
                              className={`p-time-grid ${minute % 60 === 0 ? "hour" : ""}`}
                              key={minute}
                              style={{ left: minute * pixelsPerMinute }}
                            />
                          ))}
                          {ticks.map((minute) => (
                            <div
                              className="p-time-grid minor"
                              key={`minor-${minute}`}
                              style={{
                                left: (minute + tickStep / 2) * pixelsPerMinute,
                              }}
                            />
                          ))}
                        </div>
                      );
                    })}
                    {machine.downtime
                      .filter((d) => dates.includes(d.date))
                      .map((d) => (
                        <div
                          key={d.id}
                          className="p-downtime"
                          title={`${d.reason}: ${clockTime(d.startMinute)} to ${clockTime(d.endMinute)}`}
                          style={{
                            left:
                              (dayDifference(d.date, start) * 1440 +
                                d.startMinute) *
                              pixelsPerMinute,
                            width:
                              (d.endMinute - d.startMinute) * pixelsPerMinute,
                          }}
                        />
                      ))}
                    {dates.includes(today) && (
                      <div
                        className="p-now-line"
                        title={`Now ${clockTime(currentMinute)}`}
                        style={{
                          left:
                            (dayDifference(today, start) * 1440 +
                              currentMinute) *
                            pixelsPerMinute,
                        }}
                      />
                    )}
                    {segments.map(
                      ({ job, left, width, lane, durationWidth }) => {
                        const order = data.orders.find(
                            (o) => o.id === job.orderId,
                          )!,
                          stage = stageFor(job)!;
                        const movable = allowed && stage.status === "queued",
                          status =
                            plan.orders.find((o) => o.orderId === order.id)
                              ?.status ?? "scheduled";
                        const isDragging = drag?.job.id === job.id;
                        const shift = isDragging
                          ? (dayDifference(drag.date, job.date) * 1440 +
                              drag.startMinute -
                              job.startMinute) *
                            pixelsPerMinute
                          : 0;
                        const title = `${order.number} · ${stage.name}\n${fmtDate(job.date)} · ${clockTime(job.startMinute)} to ${clockTime(job.startMinute + job.minutes)} · ${job.minutes} min`;
                        return (
                          <div
                            className={`p-segment ${status} ${isDragging ? "is-dragging" : ""}`}
                            key={job.id}
                            data-allocation-id={job.id}
                            onPointerDown={(e) => {
                              suppressClick.current = false;
                              if (!movable || e.button !== 0 || saving.current)
                                return;
                              e.preventDefault();
                              e.currentTarget.setPointerCapture(e.pointerId);
                              const track = e.currentTarget.closest(
                                  ".p-track",
                                ) as HTMLElement,
                                scroller = track.closest(
                                  ".p-board-scroll",
                                ) as HTMLElement;
                              const d: Drag = {
                                job,
                                x: e.clientX,
                                y: e.clientY,
                                initialX: e.clientX,
                                initialY: e.clientY,
                                scroll: scroller.scrollLeft,
                                delta: 0,
                                date: job.date,
                                startMinute: job.startMinute,
                                pixelsPerMinute,
                                snap,
                                track,
                                scroller,
                                revision: data.tenant.revision,
                              };
                              dragRef.current = d;
                              setDrag(d);
                            }}
                            onPointerMove={(e) => {
                              if (dragRef.current) {
                                const next = dragPosition(
                                  dragRef.current,
                                  e.clientX,
                                  e.clientY,
                                );
                                dragRef.current = next;
                                setDrag(next);
                              }
                            }}
                            onPointerUp={() => void drop()}
                            onPointerCancel={() => {
                              suppressClick.current = true;
                              cancelDrag();
                            }}
                            onLostPointerCapture={() => {
                              if (dragRef.current) {
                                suppressClick.current = true;
                                cancelDrag();
                              }
                            }}
                            onClick={(e) => {
                              if (suppressClick.current) {
                                e.preventDefault();
                                suppressClick.current = false;
                                return;
                              }
                              open(job);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                open(job);
                              }
                            }}
                            title={title}
                            style={{
                              touchAction: movable ? "none" : "auto",
                              left,
                              width,
                              top: 20 + lane * 84,
                              transform: isDragging
                                ? `translateX(${shift}px)`
                                : undefined,
                            }}
                          >
                            <span
                              className="p-segment-duration"
                              aria-hidden="true"
                              style={{ width: durationWidth }}
                            />
                            {movable && (
                              <button
                                type="button"
                                className="p-drag-handle"
                                title={`${title}\nDrag to move; click to edit`}
                                aria-label={`Drag ${order.number} ${stage.name}`}
                              >
                                <GripVertical size={15} />
                              </button>
                            )}
                            <button
                              type="button"
                              className="p-segment-info"
                              aria-label={`${order.number}, ${stage.name}, ${fmtDate(job.date)}, ${clockTime(job.startMinute)} to ${clockTime(job.startMinute + job.minutes)}`}
                              title={title}
                            >
                              <strong>
                                {job.locked && <LockKeyhole size={11} />}{" "}
                                {order.number}
                              </strong>
                              <span>{stage.name}</span>
                              <small>
                                {clockTime(job.startMinute)}–
                                {clockTime(job.startMinute + job.minutes)}
                              </small>
                            </button>
                          </div>
                        );
                      },
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      </div>
      <div className="p-calendar-legend">
        <span>
          <i className="p-legend-duration" />
          Colored bar = scheduled duration
        </span>
        <span>
          <i className="p-legend-available" />
          Available shift
        </span>
        <span>
          <i className="p-legend-unavailable" />
          Off shift / unavailable capacity
        </span>
        <span>
          <i className="p-legend-now" />
          Current time
        </span>
      </div>
      {!visibleJobs.length && (
        <p className="p-empty">
          No production scheduled{" "}
          {view === "day" ? "on this day" : "in this week"}. Choose another date
          or review the order risks below.
        </p>
      )}
      <details className="p-segment-list" open>
        <summary>
          Scheduled segments · {fmtDate(start)}
          {view !== "day" ? ` to ${fmtDate(dates.at(-1)!)}` : ""}
        </summary>
        <div>
          {[...visibleJobs]
            .sort(
              (a, b) =>
                a.date.localeCompare(b.date) || a.startMinute - b.startMinute,
            )
            .map((job) => (
              <button
                className="p-segment-detail"
                key={job.id}
                aria-label={`Details for ${data.orders.find((o) => o.id === job.orderId)?.number} ${stageFor(job)?.name} ${job.date}`}
                onClick={() => open(job)}
              >
                <strong>
                  {data.orders.find((o) => o.id === job.orderId)?.number} ·{" "}
                  {stageFor(job)?.name}
                </strong>
                <span>
                  {data.machines.find((m) => m.id === job.machineId)?.name}
                </span>
                <small>
                  {fmtDate(job.date)} · {clockTime(job.startMinute)} to{" "}
                  {clockTime(job.startMinute + job.minutes)} · {job.minutes} min
                  {job.locked ? " · Locked" : ""}
                </small>
              </button>
            ))}
        </div>
      </details>
      {selected && (
        <SegmentEditor
          key={`${selected.id}:${selected.revision}`}
          selected={selected}
          data={data}
          allowed={allowed}
          close={() => setSelected(null)}
          save={save}
          reload={() => {
            const latest = plan.allocations.find((a) => a.id === selected.id);
            setSelected(
              latest ? { ...latest, revision: data.tenant.revision } : null,
            );
          }}
        />
      )}
    </>
  );
}
function SegmentEditor({
  selected,
  data,
  allowed,
  close,
  save,
  reload,
}: {
  selected: Selection;
  data: Workspace;
  allowed: boolean;
  close: () => void;
  reload: () => void;
  save: (action: Action, revision?: number) => Promise<void>;
}) {
  const [minute, setMinute] = useState(selected.startMinute),
    [placement, setPlacement] = useState("exact"),
    [date, setDate] = useState(selected.date),
    [unlockError, setUnlockError] = useState("");
  const order = data.orders.find((o) => o.id === selected.orderId)!,
    stage = order.stages.find((s) => s.id === selected.stageId)!,
    machine = data.machines.find((m) => m.id === selected.machineId)!,
    editable = allowed && stage.status === "queued";
  const end = minute + selected.minutes;
  return (
    <FormDialog
      title="Production segment"
      close={close}
      reload={reload}
      submit={async (f) => {
        if (!editable) return;
        await save(
          {
            action: "plan.move",
            allocationId: selected.id,
            date,
            startMinute: placement === "exact" ? minute : undefined,
            locked: f.get("locked") === "on",
          },
          selected.revision,
        );
      }}
    >
      <h3>
        {order.number} · {stage.name}
      </h3>
      <p className="muted">
        Work center:{" "}
        <strong>
          {machine.name} ({machine.code})
        </strong>{" "}
        · {selected.minutes} minutes
      </p>
      <fieldset disabled={!editable}>
        <Field label="Production date">
          <input
            name="date"
            type="date"
            min={data.plan!.startDate}
            max={data.plan!.endDate}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </Field>
        <Field label="Time placement">
          <select
            value={placement}
            onChange={(e) => setPlacement(e.target.value)}
          >
            <option value="exact">Exact start time</option>
            <option value="available">First available on this day</option>
          </select>
        </Field>
        {placement === "exact" && (
          <TimeField label="Start time" value={minute} change={setMinute} />
        )}
        {placement === "exact" && (
          <div className="p-time-summary">
            <Clock3 size={18} />
            <div>
              <strong>
                {clockTime(minute)} to{" "}
                {clockTime(end <= 1440 ? end : end % 1440)}
                {end > 1440 ? " next day" : ""}
              </strong>
              <small>
                {selected.minutes} min · {data.tenant.timeZone}
              </small>
            </div>
          </div>
        )}
        <label className="p-check">
          <input
            type="checkbox"
            name="locked"
            defaultChecked={selected.locked}
          />
          Keep this segment fixed when recalculating
        </label>
      </fieldset>
      <p className="muted">
        {placement === "exact"
          ? "The chosen time must fit the available shift, material supply and surrounding production stages. It will not be moved to another time automatically."
          : "The schedule will choose the first continuous free window on the selected day."}
      </p>
      {unlockError && (
        <p className="p-error" role="alert">
          {unlockError}
        </p>
      )}
      {editable && selected.locked && (
        <button
          className="button"
          type="button"
          onClick={async () => {
            try {
              await save(
                {
                  action: "plan.lock",
                  allocationId: selected.id,
                  locked: false,
                },
                selected.revision,
              );
              close();
            } catch (e) {
              setUnlockError(
                e instanceof Error ? e.message : "Could not unlock.",
              );
            }
          }}
        >
          Unlock and recalculate
        </button>
      )}
    </FormDialog>
  );
}
