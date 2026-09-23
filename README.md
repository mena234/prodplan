# ProdPlan

Live demo: [https://prodplan.ramzy.tech/](https://prodplan.ramzy.tech/)


Production planning around customer orders, work-center capacity, material stock
and delivery dates. The public landing page is `/`; **Try live demo** opens the
real `/app` in a private sample workspace. Sign-in and registration are at `/login`.
There is one application and one scheduling engine for demo and account users.

## Application

React and TypeScript App Router screens run through Vinext on Cloudflare Workers,
hosted by Sites with D1 storage. Better Auth manages real accounts. Tenant-scoped
memberships, role checks, revision guards and audit history protect production data.

The app includes work centers and shifts, materials and receipts, product BOMs and
sequential routes, orders/import, finite-capacity scheduling, minute-precision
rescheduling, floor progress, delivery tracking, schedule comparison, analytics,
CSV/PDF exports, team access and notifications. Mailgun and OpenRouter are optional
services for real workspaces. Email is currently paused by the owner's request.

The scheduler is deterministic and validates capacity, shifts, downtime, material
availability and stage precedence. Comparison evaluates several sequencing rules;
it does not claim global optimality. Orders snapshot their BOM and routing. Material
is issued once when production starts, not when an order is saved.

## Live demo lifecycle and security

- `/api/demo` creates a server-side session and one private tenant. Dates use today
  in the visitor's timezone. The sample has three work centers with continuous
  three-shift coverage, planned downtime, three materials/products, four orders,
  a partial purchase receipt, a shortage and an urgent delivery risk.
- The random 256-bit credential lives in an HttpOnly, SameSite=Lax cookie, Secure
  on HTTPS. Only its SHA-256 hash is stored. No Better Auth account is created.
- `/app?demo=1` sends a demo-mode header to the same production APIs. The header
  selects the authentication mode; it grants no access without the valid cookie.
  Every request checks the session's exact tenant and expiry. Real account APIs
  continue to require Better Auth. Real cookies and demo cookies can coexist.
- The session lasts 24 hours across refreshes and browser restarts. Reset requires
  confirmation and atomically replaces only that session's tenant. It does not
  extend expiry. Old tenant URLs no longer grant access.
- Expired sessions return HTTP 410 and lead to a fresh-start landing page. Cleanup
  removes their tenant records, plans, audits, stock history and session. Sweeps
  run in background on page/API traffic, through authenticated maintenance, and
  through the Worker's scheduled handler (15-minute cron in build configuration).
  A database lease allows one bounded sweep per minute, at most 20 tenants each.
- Demo invitations and membership changes are rejected by the server. Demo
  mutations never enqueue email. Comparison bypasses all paid AI/provider paths,
  even when an OpenRouter key is configured. Reports use the real exporter.
- Registration creates a separate real identity and starts at empty workspace
  setup. Sample data is never copied automatically.

## Demo resource limits

All limits are enforced by the server; resetting does not clear session quotas.

| Resource          | Limit                                                               |
| ----------------- | ------------------------------------------------------------------- |
| New sessions      | 5 per IP/hour, 20 globally/minute, 300 globally/day                 |
| Stored sessions   | 500                                                                 |
| Reset             | 3 per session/hour                                                  |
| Workspace reads   | 120 per session/minute                                              |
| Mutations         | 30 per minute, 200 per session                                      |
| Comparisons       | 5 per minute, 30 per session                                        |
| Reports           | 10 per minute, 50 per session                                       |
| Orders            | 40 including completed/cancelled, 200 units/order, 10 imported rows |
| Order workload    | 50,000 production minutes                                           |
| Master data       | 12 centers, 20 materials, 20 products, 30 receipts                  |
| Product route/BOM | 6 stages, 10 materials, 120 min/unit, 240 min setup                 |
| Planning horizon  | 14 days                                                             |

IP quota keys are salted hashes of the trusted Cloudflare connecting IP. Browser
storage only remembers tour progress; workspace state remains in D1. Clearing a
browser cookie does not delete the server data immediately; expiry cleanup does.

## Development and deployment

See [PLATFORM-RUNBOOK.md](PLATFORM-RUNBOOK.md) for local setup, migrations, provider
configuration, deployment and recovery. Use Node.js 22+, `npm ci`, a local `.env`
and the Sites runtime (`npm run dev:sites` or a built Wrangler preview). PostgreSQL
helpers/schema are historical and are not used by the current app.

```powershell
npm run typecheck
npm run lint
npm test
npm run build:sites
```

Sites deploys the existing project in `.openai/hosting.json` and applies the
append-only Drizzle migrations. Keep production secrets in Sites runtime settings.
Stop local Wrangler before rebuilding on Windows.

## Verification

`tests/live-demo.test.ts` covers relative seed dates, real scheduling/progress,
workload bounds and cookie parsing. `scripts/live-demo-qa.ts` tests two independent
browser visitors against the compiled local app on port 3018: isolation, auth
coexistence, tour navigation/resume, order creation/edit, precise rescheduling,
floor progress/stock issue, inventory, deterministic comparison, CSV/PDF, reset,
expiry/deletion, quotas, mobile layout and empty real registration. It uses the
local QA account fixture created by the platform test scripts. Its direct database
writes set only local demo expiry/quota test fixtures. It never targets production.

```powershell
npm run test:integration
```

Existing platform tests remain under `tests/` and `scripts/platform-*.ts`.
Historical demo QA documents describe the retired interface and are not current
acceptance criteria. There is no separate anonymous demo scheduler or API.
