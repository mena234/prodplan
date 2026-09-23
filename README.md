# ProdPlan

A manufacturing planning workspace that connects customer orders, materials, work-center capacity, production schedules, and delivery dates. The demo opens the working application in a temporary sample workspace.

**[Open the live demo](https://prodplan.ramzy.tech/)** · [Developer guide](DEVELOPMENT.md)

## What you can explore

- Orders, product bills of materials, work centers, shifts, inventory, and receipts.
- Capacity-aware scheduling, plan comparison, and rescheduling.
- Floor progress, delivery tracking, analytics, and CSV/PDF exports.
- Separate demo workspaces and account-based access with team roles.

## Try the demo

1. Open the demo and select **Try live demo**.
2. Inspect the seeded orders and the schedule, then change a sample order or move its planned work.
3. Compare plans, record production progress, or export a report. Your sample workspace is separate from other visitors.

## Technology

React, TypeScript, Vinext, Tailwind CSS, Better Auth, Drizzle, Cloudflare Workers, and D1. Mailgun and OpenRouter are optional integrations.

## Run locally

Use Node.js 24 and npm. The current application requires the Worker/D1 runtime. Start by installing dependencies:

```sh
git clone https://github.com/mena234/prodplan.git
cd prodplan
npm ci
```

Copy `.env.example` to an ignored `.env` file, set fresh values for `BETTER_AUTH_SECRET` and `CRON_SECRET`, and use the loopback authentication URL for your chosen port. Follow the [local setup runbook](PLATFORM-RUNBOOK.md#local-setup) to build, initialize a new local D1 database, and start the preview.

Use `npm run dev:sites` for development on port **3017**, or the runbook's compiled preview on port **3018** after applying migrations. `npm run build:sites` is the current production build. The plain `dev`/`build` scripts and PostgreSQL helpers belong to the earlier Next.js setup.

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run build:sites
```

## Scope and limitations

Demo sessions last 24 hours and have limits on data, requests, and resets. Demo comparisons use the deterministic scheduler and do not call paid AI services. Scheduling follows modeled capacity and material rules; it does not guarantee a globally optimal plan. Email-dependent features require configured services and are paused in the documented hosted configuration.

## More detail

The [developer guide](DEVELOPMENT.md) details demo lifecycle and quotas. The [platform runbook](PLATFORM-RUNBOOK.md) covers setup, configuration, migrations, operations, and recovery.
