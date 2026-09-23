import { describe, expect, it } from "vitest";
import {
  splitDocument,
  prepareDocument,
  readDocument,
} from "../src/production/server/documents";
describe("Large immutable documents", () => {
  it("round trips large UTF-8 and supplementary characters below D1 row limits", () => {
    const text = JSON.stringify({ name: "مصنع 🏭 ".repeat(300000) }),
      parts = splitDocument(text);
    expect(parts.length).toBeGreaterThan(1);
    const encoded = parts.map((part) => {
      expect(new TextEncoder().encode(part).length).toBeLessThan(1000000);
      return new TextDecoder().decode(new TextEncoder().encode(part));
    });
    expect(encoded.join("")).toBe(text);
  });
  it("scopes and guards every part and rejects missing parts", async () => {
    const rows: Array<{ part_index: number; content: string }> = [],
      calls: Array<{ sql: string; args: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            calls.push({ sql, args });
            if (sql.startsWith("INSERT"))
              rows.push({
                part_index: args[3] as number,
                content: args[4] as string,
              });
            return { all: async () => ({ results: rows }) };
          },
        };
      },
    } as unknown as D1Database;
    const value = {
        items: Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          name: "x".repeat(1000),
        })),
      },
      stored = prepareDocument(
        db,
        "tenant-a",
        "plan",
        "27",
        value,
        "EXISTS(SELECT 1 FROM tenants WHERE id=? AND revision=?)",
        ["tenant-a", 27],
      );
    expect(stored.writes.length).toBeGreaterThan(1);
    for (const call of calls) {
      expect(call.args.slice(0, 3)).toEqual(["tenant-a", "plan", "27"]);
      expect(call.args.slice(-2)).toEqual(["tenant-a", 27]);
      expect(call.sql).toContain("WHERE EXISTS");
    }
    expect(
      await readDocument(db, "tenant-a", "plan", "27", stored.document),
    ).toEqual(value);
    expect(calls.at(-1)?.args).toEqual(["tenant-a", "plan", "27"]);
    rows.pop();
    await expect(
      readDocument(db, "tenant-a", "plan", "27", stored.document),
    ).rejects.toThrow("incomplete");
  });
});
