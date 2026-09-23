import { z } from "zod";
import { memberAccess } from "@/production/server/access";
import { getRuntime } from "@/production/server/runtime";
import {
  errorResponse,
  HttpError,
  readJson,
  requireOrigin,
} from "@/production/server/http";
import {
  defaultRouterModel,
  rankWithOpenRouter,
} from "@/production/server/providers";
import { loadData } from "@/production/server/workspace";
import { generatePlan, validatePlan } from "@/production/scheduler";
import { digest } from "@/production/server/mutations";
import type { Plan } from "@/production/types";
import { demoOperation } from "@/production/server/demo-session";
const strategies = ["priority", "deadline", "shortest", "material"] as const;
const labels = {
  priority: "Priority first",
  deadline: "Earliest deadline",
  shortest: "Shortest jobs within priority",
  material: "Available material first",
};
export async function POST(request: Request) {
  try {
    const env = getRuntime();
    await requireOrigin(request, env.BETTER_AUTH_URL!);
    const parsed = z
      .object({
        tenantId: z.string().uuid(),
        revision: z.number().int().min(0),
      })
      .safeParse(await readJson(request));
    if (!parsed.success)
      throw new HttpError(400, "Choose a valid workspace revision.");
    const { demo } = await memberAccess(
      request.headers,
      parsed.data.tenantId,
      "plan",
    );
    if (demo) await demoOperation(demo, "compare");
    const aiEnabled = !demo && !!env.OPENROUTER_API_KEY;
    const data = await loadData(parsed.data.tenantId);
    if (data.tenant.revision !== parsed.data.revision)
      throw new HttpError(
        409,
        "The workspace changed. Refresh before comparing schedules.",
      );
    const now = new Date(),
      candidates = strategies
        .map((strategy) => ({
          strategy,
          plan: generatePlan(
            { ...data, previousPlan: data.plan },
            strategy,
            now,
          ),
        }))
        .filter((c) => !validatePlan(data, c.plan, now).length);
    if (!candidates.length)
      throw new HttpError(
        400,
        "The locked schedule conflicts with production constraints. Resolve or unlock the affected segments first.",
      );
    const metrics = candidates.map((c) => ({
      id: c.strategy,
      ...c.plan.score,
      urgentLateOrders: c.plan.orders.filter(
        (o) =>
          data.orders.find((x) => x.id === o.orderId)?.priority === "urgent" &&
          o.risks.some(
            (r) => r.code === "deadline" && r.severity === "critical",
          ),
      ).length,
    }));
    const sorted = [...metrics].sort(
      (a, b) =>
        a.blockedOrders - b.blockedOrders ||
        a.urgentLateOrders - b.urgentLateOrders ||
        a.lateOrders - b.lateOrders ||
        a.lateDays - b.lateDays ||
        b.plannedMinutes - a.plannedMinutes,
    );
    let chosen: Plan["strategy"] = sorted[0].id,
      explanation = `${labels[chosen]} has ${sorted[0].lateOrders} late and ${sorted[0].blockedOrders} incompletely planned order(s). The comparison first protects feasible production and urgent deadlines.`,
      source = demo
        ? "Deterministic comparison using the production scheduler. Paid AI calls are disabled in the demo."
        : "Deterministic comparison. No AI provider is connected.";
    const model = env.OPENROUTER_MODEL || defaultRouterModel,
      cacheKey = await digest([
        "openrouter",
        data.tenant.id,
        data.tenant.revision,
        metrics,
        model,
      ]),
      cache = aiEnabled
        ? await env.DB.prepare(
            "SELECT value,expires_at FROM verification WHERE identifier=? AND expires_at>?",
          )
            .bind(`schedule-cache:${cacheKey}`, Date.now())
            .first<{ value: string; expires_at: number }>()
        : null;
    if (cache) {
      const value = JSON.parse(cache.value);
      chosen = value.chosen;
      explanation = value.explanation;
      source = value.source;
    } else if (aiEnabled) {
      source = "AI ranking unavailable. Showing the deterministic comparison.";
      const limitKey = `optimization:${data.tenant.id}:${now.toISOString().slice(0, 13)}`;
      const allowed = await env.DB.prepare(
        "INSERT INTO rate_limit(id,key,count,last_request) VALUES(?,?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1,last_request=excluded.last_request WHERE count<10 RETURNING count",
      )
        .bind(crypto.randomUUID(), limitKey, Date.now())
        .first();
      if (allowed)
        try {
          const ranking = await rankWithOpenRouter(env, metrics);
          chosen = ranking[0].candidateId;
          explanation = ranking[0].reason;
          source =
            "AI-assisted ranking via OpenRouter. Only aggregate production metrics were sent.";
          await env.DB.prepare(
            "INSERT INTO verification(id,identifier,value,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?)",
          )
            .bind(
              crypto.randomUUID(),
              `schedule-cache:${cacheKey}`,
              JSON.stringify({ chosen, explanation, source }),
              Date.now() + 5 * 60000,
              Date.now(),
              Date.now(),
            )
            .run();
        } catch (error) {
          console.warn(
            "AI schedule ranking unavailable",
            error instanceof Error ? error.name : "Unknown error",
          );
        }
    }
    return Response.json({
      revision: data.tenant.revision,
      candidates: candidates.map((c) => ({
        strategy: c.strategy,
        label: labels[c.strategy],
        score: c.plan.score,
        recommended: c.strategy === chosen,
      })),
      explanation,
      source,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
