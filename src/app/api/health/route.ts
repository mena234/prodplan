import { getRuntime } from "@/production/server/runtime";
export async function GET() {
  try {
    await getRuntime().DB.prepare("SELECT 1 AS ready").first();
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
