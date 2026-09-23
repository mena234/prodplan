# Demo verification inventory

Functional checks: generate from unplanned factory; persisted plan after refresh; structured explanation for ORD-104 and ORD-107; all five navigation views; search and no-result state; attention filters; valid drag/drop; date-picker move; rejection of full-day maintenance and occupied shifts; frozen work; priority resequencing; exact stock receipt unblocks order; reset returns baseline; plan revision rejects stale writes; keyboard dialog escape and focus trapping; guide.

Visual checks: overview, populated board, order drawer, orders table, materials, machines at 1440 desktop; 320, 375, 414, 768 mobile/tablet; local horizontal scrolling only in dense timeline/table; no root overflow; readable state labels; desktop drawer and mobile navigation.

Off-happy-path checks: stale concurrent write, invalid payload, move to downtime, full shift rejection, no search results.

## Results — September 5, 2026

- TypeScript check, ESLint (zero warnings), production build: pass.
- Vitest: **22 / 22** engine tests pass.
- PostgreSQL integration: all 12 scenario groups pass, including same-origin browser requests, persisted reads, stale revisions, concurrent writes, inventory receipts, priority changes, frozen work and maintenance rejection.
- Browser: Chromium/Edge desktop at 1600 and 1440 px; mobile/tablet at 320, 375, 414 and 768 px. No root horizontal overflow. Dense tables and the timeline scroll inside their own containers.
- Exercised real drag/drop, date-based moves, deadline updates and recovery, priority resequencing, the 65 kg stock receipt, persisted reload, all views, attention filters, search/no-results, reset, the guide, week navigation, mobile navigation and dialog Escape.
- No browser runtime errors during the functional checks.
- Optimized production server smoke check: reset, generate, priority changes, refreshed manual-move selector, persisted reload and three baseline exceptions all pass.
- Status text color pairs meet WCAG 4.5:1; secondary text uses the verified muted token. Reduced motion is supported.
- Dependency audit: zero reported vulnerabilities. Prisma transitive dependencies are pinned to patched ranges through package overrides.
- Screenshots: `evidence/overview-desktop.png`, `evidence/material-constraint.png`, `evidence/overview-mobile.png`.

The demo uses one operation per product and a fixed factory calendar date. The local edition uses PostgreSQL. The public Sites edition uses a separate D1 workspace for each visitor; it is a demo, not authenticated production tenancy.

## Public Sites verification — September 5, 2026

- 27 unit tests pass, including five hosted persistence model and cookie tests.
- TypeScript and lint pass. Vinext Worker production build passes.
- Real local Worker/D1 integration passes: independent visitor plans, generation, stock receipts, persisted reload, atomic concurrent writes, stale revisions, origin validation, invalid receipt rejection, maintenance rejection, priority resequencing, manual moves, reset, and rendered HTML.
- Browser check passes for generation and persisted reload; no runtime errors and no root overflow at 375 px.
- Dependency updates removed all high-severity findings. Four moderate audit findings remain in Drizzle's development-only migration loader dependency chain (old esbuild development server); that loader and server are not included in the deployed Worker.
