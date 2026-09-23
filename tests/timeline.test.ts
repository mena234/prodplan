import { describe, it, expect } from "vitest";
import { dragTime } from "../src/production/timeline";
describe("minute timeline drag", () => {
  it("keeps the grab position and snaps to 1, 5 or 15 minutes", () => {
    expect(dragTime("2026-09-07", 607, 30, 1)).toEqual({
      date: "2026-09-07",
      startMinute: 637,
    });
    expect(dragTime("2026-09-07", 607, 30, 5)).toEqual({
      date: "2026-09-07",
      startMinute: 635,
    });
    expect(dragTime("2026-09-07", 607, 30, 15)).toEqual({
      date: "2026-09-07",
      startMinute: 630,
    });
  });
  it("handles dragging across midnight in both directions", () => {
    expect(dragTime("2026-09-07", 1430, 25, 5)).toEqual({
      date: "2026-09-08",
      startMinute: 15,
    });
    expect(dragTime("2026-09-08", 10, -25, 5)).toEqual({
      date: "2026-09-07",
      startMinute: 1425,
    });
  });
});
