# ProdPlan implementation plan

1. Create isolated Next.js 16 project; establish a compact Cobalt planning workbench.
2. Implement typed domain, calendar constraints, deterministic scheduling and structured conflict detection; test all requested cases plus manual moves and inventory contention.
3. Model factory entities and versioned plans with Prisma/PostgreSQL; seed 10 orders and persist scheduling actions transactionally.
4. Build overview, planning board, searchable orders, materials, machines and constraint detail drawer. Support drag/drop plus accessible date-based moves, priority changes, recalculation, and reset.
5. Run the application, typecheck, lint, unit tests, production build, API integration checks, desktop and mobile browser QA.

Source limitation: attached MVP brief is present; separate client job description mentioned by the brief was not attached.
Demo clock: Monday 14 September 2026, start of first shift. Historical completed work runs on 11 September. One in-progress order is frozen on 14 September. Quantities and duration use integers, inventory uses grams.
