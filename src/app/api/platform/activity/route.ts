import { memberAccess } from "@/production/server/access";
import { getRuntime } from "@/production/server/runtime";
import { errorResponse, HttpError } from "@/production/server/http";
import { isManifest, readDocument } from "@/production/server/documents";
export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams,
      tenantId = query.get("tenantId") ?? "",
      kind = query.get("kind") ?? "audit";
    if (!["audit", "inventory"].includes(kind))
      throw new HttpError(400, "Choose audit or inventory history.");
    await memberAccess(
      request.headers,
      tenantId,
      kind === "audit" ? "audit" : "read",
    );
    const db = getRuntime().DB;
    if (query.has("id")) {
      if (kind !== "audit") throw new HttpError(400, "Choose an audit entry.");
      const id = query.get("id")!;
      const row = await db
        .prepare(
          "SELECT document FROM audit_entries WHERE tenant_id=? AND id=?",
        )
        .bind(tenantId, id)
        .first<{ document: string }>();
      if (!row) throw new HttpError(404, "Audit entry not found.");
      return Response.json({
        item: await readDocument(db, tenantId, "audit", id, row.document),
      });
    }
    const cursor = query.get("cursor") ?? "9999",
      table = kind === "audit" ? "audit_entries" : "inventory_movements";
    const rows = await getRuntime()
      .DB.prepare(
        `SELECT document,created_at,id FROM ${table} WHERE tenant_id=? AND (created_at || ':' || id) < ? ORDER BY created_at DESC,id DESC LIMIT 101`,
      )
      .bind(tenantId, cursor)
      .all<{ document: string; created_at: string; id: string }>();
    const shown = rows.results.slice(0, 100),
      last = shown.at(-1);
    return Response.json({
      items: shown.map((r) => {
        const value = JSON.parse(r.document);
        return isManifest(value) ? value.summary : value;
      }),
      cursor:
        rows.results.length > 100 && last
          ? `${last.created_at}:${last.id}`
          : null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
