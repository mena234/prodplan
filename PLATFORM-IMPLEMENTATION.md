# ProdPlan full platform

Work starts from the verified public demo, commit 50387f07987cf4103dac38fc94ae7b1ce2a6003e.
The demo remains at `/`; the authenticated platform is at `/app` and `/login`.
The selected providers are Mailgun for email and OpenRouter for AI ranking.

## Required delivery and verification

- Accounts: email/password, verification/recovery, shared company units, membership,
  Admin/Planner/Supervisor/Viewer permissions enforced on every API request.
- Master data: machines, shifts/downtime, materials/units/lead time, product BOM and
  sequential routing. Validate references and preserve released order requirements.
- Orders: creation/editing, validated CSV import, priorities/deadlines, stage states,
  material issue and actual completion timestamps.
- Planning: finite capacity, dated supply, stages and deadlines; quantified conflicts;
  mouse/touch/keyboard moves; locked work; optimization preview and acceptance.
- Operations: start/hold/resume/complete with valid predecessor transitions,
  durable inventory movements, purchase receipts and delivery confirmation.
- Reporting: actual and projected analytics, persistent notifications, email outbox,
  CSV/PDF export and append-only audit history.
- Delivery: tested tenant isolation, role matrix, concurrent updates/idempotency,
  responsive workflows, production build, hosting, health endpoint, deployment and
  recovery documentation. External email/AI credentials and sender verification are
  tracked separately from implemented/tested code.

## Working assumptions

Each manufacturing unit is an isolated tenant. A user can belong to multiple units.
Admin manages members/settings; Planner manages orders, inventory and plans;
Supervisor records floor progress; Viewer reads permitted data and reports.
Each product has sequential stages on assigned work centers. Stages cannot overlap.
Materials are reserved for the full order and consumed once when production starts.
Expected receipts affect forecasts, and affect actual stock only when received.
Delivery dates are plant-local dates. Actual delivery requires explicit confirmation.
The scheduler preserves started/completed work and explicit planner locks.
AI proposals must pass the same deterministic constraint validation before acceptance.

## Release evidence

Verified locally on the compiled Sites application, September 6, 2026:

- 88 automated tests across six files, including the original demo, deterministic
  scheduling, production transitions, provider boundaries and large documents.
- 83 API checks: verified auth, recovery/session revocation, tenant isolation,
  viewer/supervisor/planner access, invitations, simultaneous writes, actor-specific
  idempotency, final-admin races, origin/body limits, exports and schedule comparison.
- Desktop browser flow: work centers and seven-day shifts, materials, two-stage
  product/BOM, order creation, date moves, start/progress/hold/resume/completion,
  stock issue exactly once, delivery, reports, notifications and audit expansion.
- Additional real browser input: mouse and tablet touch drag, keyboard rescheduling,
  Escape cancellation, expired invitation recovery, preserved stale drafts and
  explicit reload, decimal receipt confirmation, invalid/valid CSV import, order
  cancellation, comparison acceptance, team invitation/revocation and settings.
- The original demo's API integration and desktop/phone Create Order regression
  checks passed independently. Browser scripts reported no page errors.
- Signed Mailgun event checks: forged/expired signatures rejected; accepted and
  delivered states persisted; repeated and out-of-order events did not regress
  delivery state. No real recipient was emailed during these checks.
- The maintenance runner processed all eight then-existing local units successfully.
- Volume test: 200 orders, 20 stages, 50 BOM lines, 10,000 risks; import 3,713 ms,
  largest stored part 200,000 bytes. Full import audit and plan reload were verified.
- PDF report rendered and visually inspected; desktop, tablet and phone screenshots
  are in ignored `test-results/platform`. Type checking and targeted lint passed.
- OpenRouter passed a live structured-ranking request with the supplied credential,
  returning the expected lower-risk candidate from two aggregate test schedules.

Remaining operational evidence: live Mailgun inbox delivery and sender verification,
external unattended scheduler,
production latency/uptime monitoring, and an operator-backed backup/restore exercise.
See `PLATFORM-RUNBOOK.md` for configuration and known model boundaries. A successful
build and local tests do not establish production uptime or recovery guarantees.

### Temporary email pause, September 6

The owner requested email be disabled until Mailgun is prepared. `EMAIL_DISABLED=1`
now permits account creation and password sign-in without changing verification
records. Email-dependent recovery and invitations are paused, including direct API
requests; no new email is queued and pending delivery is paused. In-app alerts remain
active. The flag is explicit and separate from missing credentials.

All 90 automated tests pass. Browser/API checks confirmed signup, sign-in, password
rejection, workspace creation, tenant isolation, disabled invitations/recovery and
zero new outbox messages, including production alerts for a verified administrator.
A separate re-enable test confirmed unverified sessions lose workspace access,
resend verification is reachable, and completing verification restores access.

## QA inventory for the full platform

- Account flow: sign up, verification, sign in, wrong password, unverified rejection,
  reset and expired/reused reset links, logout/session revocation.
- Workspace setup: empty state, creation, switching, settings, cross-tenant reads and
  writes, all four API roles, invitation accept/revoke/expiry and final-admin races.
- Master-data controls: add/edit/delete material, work center and product; split
  shifts, downtime, multi-stage BOM/routing, reference validation and decimal stock.
- Orders: create/edit/search/filter/open/cancel/deliver, CSV template and import,
  invalid/duplicate rows, import atomicity, preserved BOM and locked-stage snapshots.
- Inventory: adjustments with reasons; expected/edit/receive/cancel receipts; no
  double receipt or double issue under retry/concurrent requests; stock ledger.
- Floor: start, progress, hold, resume, complete; blocked predecessors, occupied
  machines, actual-stock checks, preservation of work sessions and remaining setup.
- Plan: seven-day navigation, current-day calendar, closed shifts/downtime, click/date
  move, pointer drag, touch drag, keyboard access, locks/unlocks, invalid move feedback,
  conflict reasons, stale revisions and comparison preview/apply.
- Reports: actual delivery denominator, throughput, productive time excluding holds,
  utilization denominator, CSV escaping, PDF pages and download, fresh overdue flags.
- Notifications/audit: per-user reads, mark-all, tenant scope, append-only mutation
  history, older-page loading; outbox capture, lease/retry/idempotency behavior.
- Visual checks: login, empty setup, dense desktop dashboard, full multi-stage plan,
  forms/errors/details, tablet floor and 390px phone navigation/dialogs.
- Regression: original public demo and Create Order still work independently.
- Off-happy-path: two actors sharing one idempotency key; recording a real hold while
  downstream work is locked; stock arrival delayed across a plant-local date boundary.
