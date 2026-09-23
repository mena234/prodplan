// D1 limits individual rows and bound strings. Immutable plans and larger audit
// payloads therefore use ordered parts, committed in the same guarded batch.
export type DocumentKind = "plan" | "audit";
export type DocumentManifest = {
  storage: "parts-v1";
  parts: number;
  summary?: unknown;
};
export function splitDocument(document: string, size = 200000) {
  const parts: string[] = [];
  for (let start = 0; start < document.length;) {
    let end = Math.min(document.length, start + size);
    const last = document.charCodeAt(end - 1);
    if (end < document.length && last >= 0xd800 && last <= 0xdbff) end--;
    parts.push(document.slice(start, end));
    start = end;
  }
  return parts;
}
export function prepareDocument(
  db: D1Database,
  tenantId: string,
  kind: DocumentKind,
  id: string,
  value: unknown,
  guard: string,
  guardValues: unknown[],
  summary?: unknown,
) {
  const document = JSON.stringify(value),
    parts = splitDocument(document);
  if (parts.length === 1)
    return { document, writes: [] as D1PreparedStatement[] };
  const manifest: DocumentManifest = {
    storage: "parts-v1",
    parts: parts.length,
    summary,
  };
  return {
    document: JSON.stringify(manifest),
    writes: parts.map((part, index) =>
      db
        .prepare(
          `INSERT INTO document_parts(tenant_id,kind,document_id,part_index,content) SELECT ?,?,?,?,? WHERE ${guard}`,
        )
        .bind(tenantId, kind, id, index, part, ...guardValues),
    ),
  };
}
export function isManifest(value: unknown): value is DocumentManifest {
  return (
    !!value &&
    typeof value === "object" &&
    "storage" in value &&
    value.storage === "parts-v1"
  );
}
export async function readDocument<T>(
  db: D1Database,
  tenantId: string,
  kind: DocumentKind,
  id: string,
  document: string,
): Promise<T> {
  const parsed = JSON.parse(document);
  if (!isManifest(parsed)) return parsed;
  const rows = await db
    .prepare(
      "SELECT part_index,content FROM document_parts WHERE tenant_id=? AND kind=? AND document_id=? ORDER BY part_index",
    )
    .bind(tenantId, kind, id)
    .all<{ part_index: number; content: string }>();
  if (
    rows.results.length !== parsed.parts ||
    rows.results.some((r, i) => r.part_index !== i)
  )
    throw new Error("Stored document is incomplete.");
  return JSON.parse(rows.results.map((r) => r.content).join(""));
}
