import { loadWorkspace } from "@/production/server/workspace";
import {
  errorResponse,
  HttpError,
  readJson,
  requireOrigin,
} from "@/production/server/http";
import { mutate } from "@/production/server/mutations";
import { getRuntime } from "@/production/server/runtime";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("tenantId");
    if (!id) throw new HttpError(400, "Choose a production unit.");
    return Response.json(await loadWorkspace(request.headers, id));
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    await requireOrigin(request, getRuntime().BETTER_AUTH_URL!);
    return Response.json(
      await mutate(request.headers, await readJson(request)),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
