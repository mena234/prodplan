"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ArrowLeft, ArrowRight, Compass, X } from "lucide-react";
import { createPortal } from "react-dom";

export interface TourStep<View extends string = string> {
  id: string;
  title: string;
  description: string;
  detail?: string;
  view?: View;
  target?: string;
  example?: "flow" | "schedule";
}

function TourExample({ kind }: { kind: "flow" | "schedule" }) {
  if (kind === "flow")
    return (
      <ol className="tour-flow" aria-label="The production planning process">
        <li>
          <span>1</span>
          <strong>Set up</strong>
          <small>Machines, stock & products</small>
        </li>
        <li>
          <span>2</span>
          <strong>Plan</strong>
          <small>Orders & delivery dates</small>
        </li>
        <li>
          <span>3</span>
          <strong>Track</strong>
          <small>Production & delivery</small>
        </li>
      </ol>
    );
  return (
    <figure className="tour-example">
      <figcaption>Example: one order, two production stages</figcaption>
      <div className="tour-example-row">
        <strong>Cutting</strong>
        <span>09:00–10:00</span>
      </div>
      <div className="tour-example-row">
        <strong>Finishing</strong>
        <span>10:00–10:40</span>
      </div>
      <p>Finishing follows Cutting, on its own work center.</p>
    </figure>
  );
}

function GuidedTour<View extends string>({
  steps,
  index,
  move,
  close,
  finish,
  finishLabel,
}: {
  steps: readonly TourStep<View>[];
  index: number;
  move: (index: number) => void;
  close: () => void;
  finish: () => void;
  finishLabel: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const step = steps[index];
  const [spot, setSpot] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  const [placement, setPlacement] = useState<{
    top: number;
    left: number;
  } | null>(null);

  useEffect(() => {
    const node = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    node?.showModal();
    return () => {
      node?.close();
      previous?.focus({ preventScroll: true });
    };
  }, []);

  useLayoutEffect(() => {
    const target = step.target
      ? document.querySelector<HTMLElement>(step.target)
      : null;
    const banner = document.querySelector<HTMLElement>(".p-demo-banner");
    const oldMargin = target?.style.scrollMarginTop ?? "";
    if (target && banner)
      target.style.scrollMarginTop = `${banner.getBoundingClientRect().height + 20}px`;
    // Keep the screen being explained visible behind the modal, including on phones.
    target?.scrollIntoView({
      block: "start",
      inline: "nearest",
      behavior: "instant",
    });
    if (target) target.style.scrollMarginTop = oldMargin;
    const measure = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const box = target?.getBoundingClientRect();
      const cardHeight = card.current?.getBoundingClientRect().height ?? 320;
      const cardWidth = card.current?.getBoundingClientRect().width ?? 400;
      if (!box || !box.width || !box.height) {
        setSpot(null);
        setPlacement(null);
        return;
      }
      const bannerBox = banner?.getBoundingClientRect();
      const visibleTop =
        bannerBox && bannerBox.bottom > 0 && bannerBox.top < height
          ? bannerBox.bottom + 8
          : 12;
      const top = Math.max(12, visibleTop, box.top - 6);
      const left = Math.max(12, box.left - 6);
      const bottomLimit =
        width < 700 ? Math.max(96, height - cardHeight - 36) : height - 16;
      const bottom = Math.min(
        bottomLimit,
        box.bottom + 6,
        top + (width < 700 ? 180 : 260),
      );
      setSpot(
        bottom - top < 24
          ? null
          : {
              top,
              left,
              width: Math.max(0, Math.min(width - 12, box.right + 6) - left),
              height: Math.max(0, bottom - top),
            },
      );
      const below = box.bottom + 22;
      const above = box.top - cardHeight - 22;
      setPlacement({
        left: Math.max(
          12,
          Math.min(
            width - cardWidth - 16,
            width < 700 ? (width - cardWidth) / 2 : box.left,
          ),
        ),
        top:
          width < 700
            ? Math.max(12, height - cardHeight - 16)
            : below + cardHeight < height - 16
              ? below
              : above >= 16
                ? above
                : Math.max(16, height - cardHeight - 16),
      });
    };
    measure();
    const frame = requestAnimationFrame(() => {
      measure();
      heading.current?.focus({ preventScroll: true });
    });
    const observer = new ResizeObserver(measure);
    if (target) observer.observe(target);
    if (card.current) observer.observe(card.current);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [index, step.target]);

  return createPortal(
    <dialog
      ref={dialog}
      className={`product-tour ${spot ? "has-spotlight" : ""}`}
      aria-labelledby="tour-title"
      aria-describedby="tour-description"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      {spot && (
        <div className="tour-spotlight" style={spot} aria-hidden="true" />
      )}
      <div
        ref={card}
        className="tour-card"
        style={placement ? { ...placement, transform: "none" } : undefined}
      >
        <div className="tour-topline">
          <span>
            <Compass size={17} /> PRODPLAN / QUICK TOUR
          </span>
          <button
            className="icon-button"
            aria-label="Close product tour"
            onClick={close}
          >
            <X size={20} />
          </button>
        </div>
        <div
          className="tour-progress"
          aria-label={`Step ${index + 1} of ${steps.length}`}
        >
          <span style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
        </div>
        <p className="tour-counter">
          {String(index + 1).padStart(2, "0")} /{" "}
          {String(steps.length).padStart(2, "0")}
        </p>
        <h2 id="tour-title" ref={heading} tabIndex={-1}>
          {step.title}
        </h2>
        <p id="tour-description" className="tour-description">
          {step.description}
        </p>
        {step.example && <TourExample kind={step.example} />}
        {step.detail && <p className="tour-detail">{step.detail}</p>}
        <footer className="tour-footer">
          <button className="tour-skip" onClick={close}>
            Skip tour
          </button>
          <div>
            {index > 0 && (
              <button
                className="button"
                aria-label="Previous tour step"
                onClick={() => move(index - 1)}
              >
                <ArrowLeft size={16} /> Back
              </button>
            )}
            <button
              className="button primary"
              onClick={() =>
                index === steps.length - 1 ? finish() : move(index + 1)
              }
            >
              {index === steps.length - 1
                ? finishLabel
                : index === 0
                  ? "Show me around"
                  : "Next"}
              <ArrowRight size={16} />
            </button>
          </div>
        </footer>
      </div>
    </dialog>,
    document.body,
  );
}

export function TourLauncher<View extends string>({
  storageKey,
  steps,
  auto = true,
  onNavigate,
  onFinish,
  finishLabel = "Finish tour",
  label = "Product tour",
  className = "button",
}: {
  storageKey: string;
  steps: readonly TourStep<View>[];
  auto?: boolean;
  onNavigate?: (view: View) => void;
  onFinish?: () => void;
  finishLabel?: string;
  label?: string;
  className?: string;
}) {
  const [index, setIndex] = useState<number | null>(null);
  const remember = useCallback(
    (status: string, next: number) => {
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({ status, step: next }),
        );
      } catch {
        /* The tour also works when browser storage is unavailable. */
      }
    },
    [storageKey],
  );
  const move = useCallback(
    (next: number) => {
      const n = Math.max(0, Math.min(next, steps.length - 1));
      if (steps[n].view) onNavigate?.(steps[n].view!);
      setIndex(n);
      remember("active", n);
    },
    [steps, onNavigate, remember],
  );
  useEffect(() => {
    if (!auto) return;
    const timer = setTimeout(() => {
      try {
        const raw = localStorage.getItem(storageKey);
        const saved = raw ? JSON.parse(raw) : null;
        if (saved?.status === "completed" || saved?.status === "dismissed")
          return;
        move(Number.isInteger(saved?.step) ? saved.step : 0);
      } catch {
        move(0);
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [auto, storageKey, move]);
  const close = () => {
    remember("dismissed", index ?? 0);
    setIndex(null);
  };
  return (
    <>
      <button type="button" className={className} onClick={() => move(0)}>
        <Compass size={17} />
        {label}
      </button>
      {index !== null && (
        <GuidedTour
          steps={steps}
          index={index}
          move={move}
          close={close}
          finishLabel={finishLabel}
          finish={() => {
            remember("completed", index);
            setIndex(null);
            onFinish?.();
          }}
        />
      )}
    </>
  );
}

const introduction: readonly TourStep[] = [
  {
    id: "welcome",
    title: "From customer order to finished product",
    description:
      "ProdPlan helps a manufacturing team decide what to make, where to make it, and when it can be delivered. It brings orders, machine time and material stock into one production plan.",
    example: "flow",
    detail: "About 2 minutes. You can leave at any time.",
  },
  {
    id: "resources",
    title: "Start with what your plant can make",
    description:
      "Work centers are your machines or production stations. Give each one working hours and downtime. Add your raw materials and stock, then define each product’s bill of materials (BOM) and the stages needed to make it.",
    detail:
      "For example: one steel bracket needs 2 kg of steel, followed by Cutting and Finishing.",
  },
  {
    id: "orders",
    title: "Turn an order into a schedule",
    description:
      "Enter the product, quantity, priority and delivery deadline. ProdPlan checks stock and available machine time, then schedules the production stages in order.",
    example: "schedule",
    detail:
      "If materials, capacity or a deadline conflict, the plan explains what needs attention.",
  },
  {
    id: "floor",
    title: "Keep the plan connected to the floor",
    description:
      "Planners manage the schedule. Floor supervisors record stage progress and holds. Managers follow delivery risks, utilization and completed production. Everyone works from the same workspace.",
    detail:
      "Each plant has its own data and team. Admin, Planner, Floor Supervisor and Viewer roles control what each person can change.",
  },
  {
    id: "start",
    title: "Try it, then set up your own plant",
    description:
      "Try live demo opens the real app in your own temporary sample plant, without registration. Your account gives you a separate workspace for your own machines, materials, products and orders.",
    detail:
      "After sign-in, the guided tour shows you the actual screens. A setup checklist walks you through your first order.",
  },
];

export function ProductIntroduction({
  auto = false,
  onFinish,
  finishLabel = "Explore the demo",
}: {
  auto?: boolean;
  onFinish?: () => void;
  finishLabel?: string;
}) {
  return (
    <TourLauncher
      storageKey="prodplan:introduction:v1"
      steps={introduction}
      auto={auto}
      onFinish={onFinish}
      finishLabel={finishLabel}
      label="See how ProdPlan works"
      className="button tour-intro-button"
    />
  );
}
