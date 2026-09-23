"use client";

import { useMemo } from "react";
import { ArrowRight, Check, Circle } from "lucide-react";
import { TourLauncher, type TourStep } from "../../components/product-tour";
import type { Workspace } from "../types";
import { can } from "../permissions";

export type AppView =
  | "overview"
  | "planning"
  | "orders"
  | "floor"
  | "materials"
  | "products"
  | "machines"
  | "team"
  | "audit"
  | "notifications"
  | "reports";

export function WorkspaceTour({
  data,
  navigate,
}: {
  data: Workspace;
  navigate: (view: AppView) => void;
}) {
  const role = data.role;
  const demoId = data.demo ? data.tenant.id : null;
  const steps = useMemo<readonly TourStep<AppView>[]>(() => {
    if (demoId)
      return [
        {
          id: "demo-welcome",
          view: "overview",
          title: "Your own plant, ready to try",
          description:
            "This is the real ProdPlan application with a private sample workspace. Your changes stay in this browser’s demo session for 24 hours. No account is needed.",
          detail:
            "Follow a small steel-bracket order from planning to production. You can skip this tour, try the actions yourself and reset the sample plant at any time.",
          example: "flow",
        },
        {
          id: "demo-order",
          view: "orders",
          target: '[data-tour="view-content"]',
          title: "Start with four steel brackets",
          description:
            "Open DEMO-001. It has 4 steel brackets, needs 8 kg of steel, and moves through Cutting then Finishing. Cutting takes 60 minutes including setup; Finishing takes 40 minutes.",
          detail:
            "To try creating an order yourself: use Create order, enter TRY-001, choose Steel bracket, quantity 4, Urgent priority and a deadline two days from today. This puts your practice order first. Saving creates its schedule.",
        },
        {
          id: "demo-plan",
          view: "planning",
          target: ".p-board-scroll",
          title: "Choose when the work happens",
          description:
            "Find your order on the Laser cutting and Finishing line rows. Use the date selector if the work falls on a later day. Zoom into hours or minutes.",
          detail:
            "Click a task to set an exact start time such as 09:35, or drag within its row. Finishing must follow Cutting, and the move must fit the machine’s shifts and other work.",
        },
        {
          id: "demo-shortage",
          view: "materials",
          target: '[data-tour="view-content"]',
          title: "Fix a real material shortage",
          description:
            "DEMO-003 needs 36 kg of aluminium. There are only 6 kg on hand, plus a later partial receipt. Open Adjust stock for Aluminium sheet and try setting on-hand stock to 40 kg.",
          detail:
            "Then return to Planning board to see how availability changes the schedule. DEMO-004 also has a tight deadline, so fixing stock does not remove every delivery risk.",
        },
        {
          id: "demo-floor",
          view: "floor",
          target: '[data-tour="view-content"]',
          title: "Turn the plan into production",
          description:
            "For DEMO-001, start Cutting. Its 8 kg of steel is issued once. Record progress or complete Cutting, then start and complete Finishing.",
          detail:
            "Production controls record actual events. Changing the plan does not mark work complete. Try putting a stage on hold and resuming it, too.",
        },
        {
          id: "demo-reports",
          view: "reports",
          target: '[data-tour="view-content"]',
          title: "Review the result",
          description:
            "Export orders, the schedule or a PDF report. On Planning board, Compare schedules evaluates the real production constraints using several deterministic sequencing rules.",
          detail:
            "Paid AI calls, outgoing email and real team invitations are disabled in demos. The production scheduler, reports and in-app warnings work normally.",
        },
        {
          id: "demo-ready",
          view: "overview",
          title: "Try the order-to-production exercise",
          description:
            "Use the exercise on Overview to create a 4-unit bracket order, inspect its schedule and record production. Everything here belongs to your temporary demo.",
          detail:
            "Create your own workspace when you’re ready. Registration starts a separate, empty workspace and never copies sample data automatically.",
        },
      ];
    const plan = can(role, "plan");
    const floor = can(role, "floor");
    return [
      {
        id: "welcome",
        title: "A clear plan for your production team",
        description:
          "ProdPlan connects customer orders with the machines, materials and time needed to make them. You can see what is scheduled, what is being made, and which deliveries need attention.",
        view: "overview",
        example: "flow",
        detail:
          "About 3 minutes. This tour shows you around without changing any production data.",
      },
      {
        id: "workspace",
        title: "One workspace for each plant",
        description:
          "This is the manufacturing unit you are working in. Its team, machines, stock and orders belong to this workspace. Use this selector when you need to switch plants.",
        target: '[aria-label="Select workspace"]',
        view: "overview",
        detail: `Your role is ${role === "admin" ? "Admin: you can manage the plant, its team and production." : role === "planner" ? "Planner: you can set up resources, manage orders and plan production." : role === "supervisor" ? "Floor Supervisor: you can record production progress and view the plan." : "Viewer: you can follow the plan and reports, but cannot change production data."}`,
      },
      {
        id: "machines",
        title: "1. Define where work happens",
        description:
          "A work center is a machine or production station, such as Cutting or Finishing. Its shifts, daily capacity and planned downtime tell ProdPlan when work can fit.",
        target: '[data-tour="view-content"]',
        view: "machines",
        detail: plan
          ? "Start with Add work center. Use the actual shifts and capacity your team can deliver."
          : "Your planner or admin maintains these working hours and capacity limits.",
      },
      {
        id: "materials",
        title: "2. Tell the plan what is in stock",
        description:
          "Materials are the raw supplies needed for production. On-hand stock, expected receipts and lead times help identify shortages before an order is late.",
        target: '[data-tour="view-content"]',
        view: "materials",
        detail:
          "Creating an order does not consume stock. Materials are issued once when production starts.",
      },
      {
        id: "products",
        title: "3. Define how each product is made",
        description:
          "The bill of materials (BOM) lists what one unit uses. The production route lists its stages, assigned work centers, setup time and minutes per unit.",
        target: '[data-tour="view-content"]',
        view: "products",
        detail:
          "Example: 4 brackets at 2 kg each require 8 kg of steel. Cutting must finish before Finishing can start.",
      },
      {
        id: "orders",
        title: "4. Add the customer’s order",
        description:
          "An order specifies a product, quantity, priority and delivery deadline. Saving it builds the production plan using the resources you entered.",
        target: '[data-tour="view-content"]',
        view: "orders",
        detail: plan
          ? "Use Create order or Import CSV. Add a product first to enable these actions. Open any order to see its stages, material requirements and delivery status."
          : "Open an order to see its production stages, material requirements and delivery status. Planners create and update orders.",
      },
      {
        id: "planning",
        title: "5. Read the production schedule",
        description:
          "Work centers stay in rows. Dates and times run from left to right. Each task belongs to a production stage on that work center; its colored bar shows the scheduled duration.",
        target: ".p-board-scroll",
        view: "planning",
        detail: plan
          ? "Switch Day or Week, choose a zoom level, and drag within the same row. Click a task to enter an exact date, hour and minute. Changes must still fit shifts, materials and earlier stages."
          : "Switch Day or Week and zoom into hours or minutes. Click a task to inspect its timing. Your planner handles rescheduling.",
      },
      {
        id: "risks",
        title: "See what might delay delivery",
        description:
          "Conflicts & delivery risks explains material shortages, limited capacity, production holds and deadlines at risk. Open a warning to inspect the affected order.",
        target: '[data-tour="planning-risks"]',
        view: "planning",
        detail: plan
          ? "After correcting a problem, check the updated plan. Compare schedules lets you review different sequencing choices before applying one."
          : "Use these reasons to discuss a delivery problem with your planner, rather than relying on a status alone.",
      },
      {
        id: "floor",
        title: "6. Record what actually happens",
        description:
          "The Production floor shows active orders and their stages: Queued, In progress, On hold and Completed. This is where planned work becomes real production progress.",
        target: '[data-tour="view-content"]',
        view: "floor",
        detail: floor
          ? "Start the first available stage, record progress, and complete it before starting the next. Put work on hold when a problem stops production."
          : "Admins and floor supervisors update the stages. You can follow their progress here.",
      },
      {
        id: "reports",
        title: "Check results and stay informed",
        description:
          "Reports shows utilization, throughput and delivery performance, with CSV and PDF exports. Notifications brings production warnings together so your team can follow up.",
        target: '[data-tour="view-content"]',
        view: "reports",
        detail:
          role === "admin"
            ? "Use Team to manage access. Audit log records who changed production data and when."
            : "Your admin manages team access. The screens and actions you see follow your role.",
      },
      {
        id: "finish",
        title: plan
          ? "Ready for your first production plan"
          : "Ready to follow production",
        description: plan
          ? "Start with work centers, then materials, a product and an order. The checklist on Overview tracks what this workspace already has and takes you to the next step."
          : floor
            ? "Start on the Production floor to see active work. Open the Planning board to check when each stage is scheduled, and review delivery risks on Overview."
            : "Start on Overview for delivery risks, then open the Planning board or an order for more detail.",
        view: "overview",
        detail:
          "You can reopen Product tour at any time. Closing the tour keeps all your work as it is.",
      },
    ];
  }, [role, demoId]);
  return (
    <TourLauncher
      storageKey={
        demoId
          ? `prodplan:live-demo-tour:v1:${demoId}`
          : `prodplan:workspace-tour:v1:${data.user.id}:${role}`
      }
      steps={steps}
      onNavigate={navigate}
      onFinish={() => navigate(role === "supervisor" ? "floor" : "overview")}
      finishLabel={
        role === "supervisor" ? "Open production floor" : "Go to overview"
      }
    />
  );
}

export function SetupChecklist({
  data,
  navigate,
}: {
  data: Workspace;
  navigate: (view: AppView) => void;
}) {
  if (!can(data.role, "masters")) return null;
  if (data.demo)
    return (
      <section className="p-onboarding">
        <p className="tour-counter">TRY IT YOURSELF · ABOUT 5 MINUTES</p>
        <h2>Make four steel brackets</h2>
        <p>
          Create order <strong>TRY-001</strong> for 4 Steel brackets, with
          Urgent priority and a deadline two days from today so it runs first.
          It needs 8 kg of steel, 60 minutes of Cutting and 40 minutes of
          Finishing.
        </p>
        <ol>
          <li>
            <div>
              <strong>1. Create the order</strong>
              <small>
                Use any customer name, product Steel bracket, quantity 4.
              </small>
            </div>
            <button className="p-link" onClick={() => navigate("orders")}>
              Open orders <ArrowRight size={15} />
            </button>
          </li>
          <li>
            <div>
              <strong>2. Inspect its schedule</strong>
              <small>Click a task to choose a date and exact start time.</small>
            </div>
            <button className="p-link" onClick={() => navigate("planning")}>
              Open plan <ArrowRight size={15} />
            </button>
          </li>
          <li>
            <div>
              <strong>3. Record production</strong>
              <small>Start and complete Cutting, then Finishing.</small>
            </div>
            <button className="p-link" onClick={() => navigate("floor")}>
              Open floor <ArrowRight size={15} />
            </button>
          </li>
          <li>
            <div>
              <strong>4. Check the result</strong>
              <small>Inspect throughput and export a report.</small>
            </div>
            <button className="p-link" onClick={() => navigate("reports")}>
              Open reports <ArrowRight size={15} />
            </button>
          </li>
        </ol>
        <p>
          Also try adjusting aluminium stock to resolve DEMO-003’s shortage.
          Reset demo restores all sample data.
        </p>
      </section>
    );
  const steps = [
    {
      view: "machines" as const,
      title: "Add a work center",
      detail: "A machine, its capacity and working hours",
      done: data.machines.length > 0,
      ready: true,
    },
    {
      view: "materials" as const,
      title: "Add a material",
      detail: "Raw materials and the stock you have",
      done: data.materials.length > 0,
      ready: true,
    },
    {
      view: "products" as const,
      title: "Define a product",
      detail: "Materials per unit and production stages",
      done: data.products.length > 0,
      ready: data.machines.length > 0 && data.materials.length > 0,
    },
    {
      view: "orders" as const,
      title: "Create your first order",
      detail: "Product, quantity, priority and deadline",
      done: data.orders.length > 0,
      ready: data.products.length > 0,
    },
  ];
  const count = steps.filter((s) => s.done).length;
  if (count === steps.length) return null;
  const next = steps.find((s) => !s.done && s.ready)!;
  return (
    <section className="p-onboarding" aria-labelledby="setup-title">
      <div className="p-section-head">
        <div>
          <p className="tour-counter">YOUR FIRST PRODUCTION PLAN</p>
          <h2 id="setup-title">Set up your workspace</h2>
        </div>
        <span className="p-setup-count">
          {count} of {steps.length} complete
        </span>
      </div>
      <p>
        Start with your plant’s resources. Each step gives the scheduler the
        information it needs.
      </p>
      <ol>
        {steps.map((step) => (
          <li key={step.view} className={step.done ? "complete" : ""}>
            <span aria-label={step.done ? "Complete" : "Not complete"}>
              {step.done ? <Check size={18} /> : <Circle size={18} />}
            </span>
            <div>
              <strong>{step.title}</strong>
              <small>{step.detail}</small>
            </div>
            <button
              className="p-link"
              disabled={!step.ready}
              onClick={() => navigate(step.view)}
              aria-label={`${step.done ? "Review" : "Set up"} ${step.title.toLowerCase()}`}
            >
              {step.done ? "Review" : "Set up"}
              <ArrowRight size={15} />
            </button>
          </li>
        ))}
      </ol>
      <button className="button primary" onClick={() => navigate(next.view)}>
        Continue: {next.title.toLowerCase()}
        <ArrowRight size={16} />
      </button>
    </section>
  );
}
