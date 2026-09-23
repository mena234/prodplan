# Create order QA

Coverage: Orders entry point, customer/product/quantity/priority/deadline fields,
production requirements preview, validation, cancel/Escape, save/loading/errors,
new order details, counts, search, scheduling, shortages, persistence, visitor
isolation, stale-tab recovery, reset, desktop and phone layout.

Exploratory checks: whitespace-only customer, fractional/zero/oversized quantity,
unknown product through the API, past and invalid dates, later-year deadline,
concurrent creates, stock shortage, and create while an existing plan has manual moves.

Verified September 5, 2026:

- 43 unit tests pass, including unique IDs, full workload scheduling, frozen work,
  material shortages, invalid input, dates, stale creates, resets and the demo limit.
- Type checking, lint and the production Sites build pass.
- Interactive desktop and 375px phone checks pass. The form and requirements are
  readable, its scrollable dialog keeps submission accessible, and no horizontal
  overflow or browser runtime errors were found.
- Browser regression covers required/invalid fields, cancel/Escape, save, correct
  product workload, live counts, search, persistence, stale-tab retained form and
  retry, reset and phone shortage feedback.
- Existing mouse/touch/keyboard board regression passes, including edge scrolling,
  invalid destinations, frozen jobs, navigation and persisted manual moves.
- Hosted HTTP integration passes on the compiled Worker: visitor isolation, persisted
  creates, unique IDs, concurrent create 200/409, invalid order 400, material shortage,
  priority, movement, receipt and reset. A rejected cross-origin request is drained
  before its 403 response; this fixes a Worker request-stream failure exposed by QA.
- Manual exploratory checks confirm later-year deadlines display the correct year
  and creating an order recalculates prior manual placements, as the form describes.

The feature uses the five existing demo products and their BOMs/work centers.
Product master editing, order editing/deletion/imports, authenticated accounts and
full production multi-tenancy remain outside this change.
