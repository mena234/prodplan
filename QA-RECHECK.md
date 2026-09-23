# Manual recheck, September 5, 2026

Scope: every implemented demo control, with special attention to drag/drop. This does not claim implementation of the proposed production SaaS modules.

| Area                    | Functional check                                                                                                                                                  | Visual states / evidence                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Overview                | Generate, recalculate, reset, dismiss notice, attention links                                                                                                     | Ready and saved plan, computed KPIs                                |
| Board                   | Mouse drag to free day and onto another job; reject downtime, full day and wrong center; preserve frozen jobs; cancel; repeated moves; touch drag; same-day no-op | Drag preview, allowed/invalid targets, feedback, actual moved card |
| Weeks                   | Next/previous, boundary buttons, move to second week using details                                                                                                | Both weeks and horizon edges                                       |
| Orders                  | All/active/attention/completed, search by order/customer/product, empty results, clear, details                                                                   | Table, empty state, drawer                                         |
| Details                 | Every order, priority changes and restore, segment selector, date move, invalid move, Escape/close/backdrop                                                       | Constraints, materials, segments, updated dates and notices        |
| Materials               | Stock/reserved/shortage, receipt, cancel, invalid quantity, shortage clears, BOMs                                                                                 | Receipt dialog and updated stock                                   |
| Work centers            | Navigation and capacity/utilization/downtime match board                                                                                                          | All machine cards                                                  |
| Guide/navigation        | Guide entry points, close, all views, mobile navigation                                                                                                           | Desktop and 375 px mobile                                          |
| Persistence/concurrency | Reload, other visitor isolation, stale tab recovery, repeated quick actions                                                                                       | Saved plan and understandable error                                |
| Responsive/exploratory  | 375 px phone, touch tablet, narrow desktop, 200% text, horizontally scrolled board, keyboard moves                                                                | No root overflow, accessible controls, no overlay clipping         |

Checks must use real browser mouse, touch or keyboard input for signoff. Inspect API/DOM only to corroborate observed results. Capture screenshots of important final states. Record findings and completed checks below.

## Findings and results

- Reproduced: native HTML dragging moved a desktop job but did not move the same job with touch input. Invalid targets were highlighted as if valid until the server rejected the drop.
- Fixed: pointer-based dragging with a 6 px activation threshold, pointer capture, a floating preview, matching capacity checks, valid/invalid target feedback, Escape cancellation, same-day no-op, and horizontal/page edge scrolling. Touch starts from a 44 px grip; card bodies remain scrollable and selectable.
- Fixed: section navigation now returns to the top. The home logo now resets the internal view to Overview. Dashboard shortcuts have explicit accessible labels.
- Manually passed: mouse move/repeat/return; touch on tablet and 375 px phone; mobile horizontal auto-scroll and successful drop; drop onto an occupied card with sufficient capacity; wrong center, full day and maintenance rejection; same-day no-op; Escape cancellation; frozen jobs; keyboard details and date moves; second-week moves and week boundaries.
- Manually passed: all ten order details; all/active/completed/attention filters; ID/customer/product search; no-results and clear; priority resequencing and restore; segment selection; date/weekend/horizon validation; shortage explanation; 65 kg receipt and recalculation; empty/zero/negative/oversized receipt rejection; receipt cancellation; all five BOMs and three machine cards.
- Manually passed: overview shortcuts, metric shortcuts, guide entry points, Escape/close/backdrop, notice dismissal, home, all navigation sections, mobile menu, reload persistence, distinct visitor state, stale-tab rejection and retry, reset and regeneration.
- Visual review: desktop 1440 px, touch tablet 1280 px, phone 375 px, and a 720 CSS-pixel high-density viewport equivalent to a 1440 px display at 200% zoom. No root horizontal overflow, obscured dialogs, broken drag previews, or browser runtime errors. Dense timelines/tables scroll within their containers.
- Exploratory coverage included changing sections from a scrolled page, repeated moves, a partly occupied destination, stale tabs, and touch movement through a horizontally scrolled board. This exposed the navigation/home defects and confirmed their fixes.
- Repeatable interaction regression: `npx tsx scripts/board-interaction.ts`; use `DEMO_URL` to test the published version. The script uses real mouse, keyboard and touch input with separate visitor contexts.
