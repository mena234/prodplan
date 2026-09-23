# ProdPlan platform runbook

## Routes and architecture

`/` introduces ProdPlan and offers Try live demo, sign-in and registration. `/app`
is the shared manufacturing platform; `/login` supports signup, verification,
sign-in and password reset. A demo is a temporary tenant in the same application,
authorized only by its own short-lived cookie. It cannot access account tenants.
See README for its lifecycle, server limits and cleanup behavior.

The hosted application runs React/App Router through Vinext on Cloudflare Workers,
with Sites-managed D1. Better Auth stores accounts and sessions separately from
tenant memberships. Every business API resolves the signed-in user and membership;
write batches recheck permissions and the tenant revision before any changes commit.
Only an administrator can manage the team and access audit history. A planner
controls orders, masters, inventory and plans; supervisors record floor progress;
viewers can read and export reports.

Orders snapshot their BOM and sequential routing. Inventory uses integer thousandths
of a unit. Stock is issued once when production starts and received once when a
receipt is confirmed. Expected receipts inform forecasts but cannot start physical
production without actual stock. Production events release affected future locks
and record why. Client idempotency keys and server-generated attempt IDs protect
retries and simultaneous edits. Audit entries and plan versions are immutable.
Large plans/audits are stored as tenant-scoped ordered parts in the same transaction,
so the database's per-row size limit does not prevent large imports.

## Local setup

Use Node.js 22+ and `npm ci`. Copy `.env.example` to `.env` only if it does not exist.
Generate independent random secrets for `BETTER_AUTH_SECRET` and `CRON_SECRET`.
Never reuse the example values. `AUTH_EMAIL_CAPTURE=1` works only with a loopback
HTTP auth URL. It retains local test email in the outbox; no public mailbox endpoint
exists. The QA helper reads the local test database without exposing links in logs.

The application requires the Sites runtime. Use `npm run dev:sites` at port 3017
with `BETTER_AUTH_URL=http://127.0.0.1:3017`, or test the compiled application:

```powershell
$env:WRANGLER_SEND_METRICS='false'
$env:WRANGLER_LOG_PATH='.wrangler/logs'
$env:WRANGLER_REGISTRY_PATH="$PWD/.wrangler/registry-order"
$env:XDG_CONFIG_HOME="$PWD/.wrangler/config"
npm run build:sites
# On a NEW local database, apply all migrations:
npx wrangler d1 migrations apply DB --config dist/server/wrangler.json --local --persist-to .wrangler/state
# Set BETTER_AUTH_URL=http://127.0.0.1:3018 in .env first:
npx wrangler dev --config dist/server/wrangler.json --env-file .env --persist-to .wrangler/state --ip 127.0.0.1 --port 3018
```

Use an absolute env-file path if Wrangler resolves the relative path beside its
generated configuration. Stop the preview before rebuilding on Windows. For a
database previously migrated using another runner, inspect its schema/migration
history before applying anything; do not replay already applied CREATE/ALTER SQL.

## Production configuration

Store production values as Sites runtime secrets, not in the hosting manifest or
source repository. The ignored `.env.production.local` is a private handoff file;
it is not the deployed configuration. Set:

| Name                          | Value / purpose                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `BETTER_AUTH_URL`             | `https://prodplan.ramzy.tech`                                                                                |
| `BETTER_AUTH_SECRET`          | Cryptographically random, at least 32 characters; secret                                                     |
| `CRON_SECRET`                 | Separate random bearer token; secret                                                                         |
| `AUTH_EMAIL_CAPTURE`          | Unset in production                                                                                          |
| `EMAIL_DISABLED`              | Temporary `1` allows signup/signin without verification and pauses all email-dependent features; default `0` |
| `MAILGUN_API_KEY`             | Mailgun sending key; secret                                                                                  |
| `MAILGUN_DOMAIN`              | Verified sending domain, without a URL scheme                                                                |
| `MAILGUN_REGION`              | `us` or `eu`, matching the domain's Mailgun region                                                           |
| `EMAIL_FROM`                  | Approved sender, for example `ProdPlan <plan@your-domain>`                                                   |
| `MAILGUN_WEBHOOK_SIGNING_KEY` | Mailgun webhook signing key; secret                                                                          |
| `OPENROUTER_API_KEY`          | OpenRouter API key; secret                                                                                   |
| `OPENROUTER_MODEL`            | Default `openai/gpt-4.1-mini`; must support strict structured output                                         |

Redeploy a saved Sites version after runtime configuration changes. Configure
Mailgun's accepted, delivered, temporary-failure and permanent-failure webhooks at
`https://prodplan.ramzy.tech/api/webhooks/mailgun`. Verify the sending domain's DNS
inside Mailgun before re-enabling email. Test signup, delivery, verification,
invitations and password reset with approved test recipients after connecting it.

### Temporary email pause

The owner requested `EMAIL_DISABLED=1` while preparing Mailgun. Registration and
password sign-in work without a verification step; user records remain unverified.
Password validation, roles and tenant membership checks still apply. Verification,
password reset emails and invitation creation/acceptance are paused. In-app alerts
continue, but no new outbox emails are created and existing queued messages are not
sent. Setting Mailgun keys alone cannot override this explicit pause.

When Mailgun is ready, set `EMAIL_DISABLED=0` (or remove it) in Sites and redeploy.
Unverified accounts will then need verification before opening a workspace. Signing
in presents the resend-verification screen. Expired authentication messages are
cancelled instead of sending stale links. Do not set accounts' `email_verified`
fields just to migrate out of the temporary mode.

Mailgun submission and delivery are distinct. `accepted` means the provider queued
the message; `delivered` comes from a signed event. A 429 retries with bounded
backoff. A network timeout, ambiguous failure or expired sending lease becomes
`uncertain`, without automatic resubmission. Check Mailgun's logs and signed events
before manually retrying such a message. This avoids assuming an idempotency
guarantee the Mailgun send API does not provide. Only opaque outbox IDs are attached
as provider correlation metadata; auth links are never exposed through application
APIs or logs. Provider credentials alone are not proof of inbox delivery.

OpenRouter receives aggregate candidate scores only. It does not receive customer
names, order references, inventory or BOM contents. The app builds and validates
four deterministic strategies first, validates the returned ranking, and requires
planner acceptance. Malformed, refused or unavailable responses fall back to the
deterministic comparison. Requests are limited to 10 per unit/hour and cached for
five minutes. AI ranking is advisory and does not establish a global optimum.

## Background maintenance and monitoring

Run `npx tsx scripts/run-maintenance.ts` every minute in an external scheduler with
`PRODPLAN_URL=https://prodplan.ramzy.tech` and secret `CRON_SECRET`. It processes all
tenant pages, date-driven delivery-risk notifications and the email outbox. Each
HTTP request is bounded; the script follows the returned cursor. Do not put the
bearer token in a query string, source control or job logs. The Sites integration
available here does not provision an unattended scheduler, so this must be connected
separately before relying on overnight alerts or idle-period email retries.

Monitor `GET /api/health` every minute and alert on repeated non-200 responses. It
checks database availability only; separately monitor failed/uncertain email, the
maintenance job and synthetic login/plan workflows. Record production latency and
availability over time. Local tests do not prove the 99.5% uptime or sub-2-second
production page-load target.

## Deployment and rollback

Keep the existing `.openai/hosting.json` project ID. Generate append-only migrations
with `npm run db:generate:sites`; run tests, type checking, lint and the Sites build.
Publish the exact validated source/build through the existing Site. Sites applies
the packaged D1 migrations. Never include local `.env*`, `.wrangler`, test credentials
or test databases in the archive. The current migrations add tables/columns without
deleting the existing anonymous demo data.

For an application failure, redeploy a previously saved compatible version. Do not
reverse schema migrations blindly. Schema rollback and data recovery are separate
operations. Before live plant data is entered, agree backup retention and restore
access with the Sites/database operator, create an independent encrypted backup,
restore it to an isolated database and verify tenant counts, memberships, orders,
stock movements, document parts and the latest plan. A production restore exercise
has not been performed in this session; do not claim otherwise.

## Handover and known boundaries

First administrator: create and verify an account, create a manufacturing unit,
add shifts/work centers and materials, define a product's BOM and ordered stages,
then create/import orders. Invite colleagues with the minimum required role. Each
unit has its own timezone, planning horizon and dispatch buffer. Limits are 20
units per account, 250 members per unit, 1,000 active orders, 200 orders/import,
50 BOM lines/product and 20 sequential stages/product. Retain these bounds until
the larger operating envelope has been measured.

The initial scheduling model uses fixed assigned work centers, whole-minute cycle
times, sequential stages and full-order material issue. Labor/tooling, alternate
machine selection, split transfer batches, scrap/rework and ERP synchronization
need agreed plant rules before expansion. CSV preserves Unicode; the present PDF
report uses a Western-European font and should be extended with licensed multilingual
fonts before using non-Latin plant data. The floor view refreshes every 15 seconds;
it does not use a push socket.

Source references: [Mailgun sending](https://documentation.mailgun.com/docs/mailgun/api-reference/send/mailgun/messages/post-v3--domain-name--messages),
[Mailgun webhook verification](https://documentation.mailgun.com/docs/mailgun/user-manual/webhooks/securing-webhooks),
[OpenRouter structured output](https://openrouter.ai/docs/guides/features/structured-outputs),
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/).
