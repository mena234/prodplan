import { z } from "zod";
import type { Runtime } from "./runtime";
import { readBody } from "./http";
import { isEmailDisabled } from "./email-mode";

export function mailgunHost(env: Runtime) {
  return env.MAILGUN_REGION === "eu"
    ? "https://api.eu.mailgun.net"
    : "https://api.mailgun.net";
}
export function emailReady(env: Runtime) {
  return !!(
    !isEmailDisabled(env) &&
    env.MAILGUN_API_KEY &&
    env.EMAIL_FROM &&
    env.MAILGUN_DOMAIN &&
    /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(env.MAILGUN_DOMAIN) &&
    (!env.MAILGUN_REGION || ["us", "eu"].includes(env.MAILGUN_REGION))
  );
}
export function messageId(env: Runtime, id: string) {
  return `<prodplan-${id}@${env.MAILGUN_DOMAIN}>`;
}
type MailResult =
  | { status: "accepted"; providerId: string }
  | { status: "retry" | "failed" | "uncertain"; error: string };
export async function sendMailgun(
  env: Runtime,
  mail: { id: string; recipient: string; subject: string; body: string },
): Promise<MailResult> {
  if (!emailReady(env))
    return { status: "failed", error: "Mailgun configuration is incomplete." };
  const form = new FormData();
  for (const [key, value] of Object.entries({
    from: env.EMAIL_FROM!,
    to: mail.recipient,
    subject: mail.subject,
    text: mail.body,
    "h:Message-Id": messageId(env, mail.id),
    "v:outbox_id": mail.id,
    "o:tracking": "no",
    "o:tracking-clicks": "no",
    "o:tracking-opens": "no",
  }))
    form.set(key, value);
  try {
    const response = await fetch(
      `${mailgunHost(env)}/v3/${encodeURIComponent(env.MAILGUN_DOMAIN!)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`api:${env.MAILGUN_API_KEY}`)}`,
        },
        body: form,
        signal: AbortSignal.timeout(10000),
      },
    );
    if (response.status === 429) {
      await response.arrayBuffer();
      return { status: "retry", error: "Mailgun rate limit reached." };
    }
    if (!response.ok) {
      await response.arrayBuffer();
      return {
        status:
          response.status >= 500 || response.status === 408
            ? "uncertain"
            : "failed",
        error: `Mailgun returned ${response.status}.`,
      };
    }
    const raw = await readBody(response, 100000);
    const result = z
      .object({ id: z.string().min(1).max(500) })
      .parse(JSON.parse(raw));
    return { status: "accepted", providerId: result.id };
  } catch {
    // Mailgun does not promise send-request idempotency. A timeout may follow
    // acceptance, so a signed webhook must reconcile it before any resend.
    return {
      status: "uncertain",
      error:
        "Submission outcome is unknown. Awaiting Mailgun delivery events; no automatic resend.",
    };
  }
}

export const scheduleStrategies = [
  "priority",
  "deadline",
  "shortest",
  "material",
] as const;
type Strategy = (typeof scheduleStrategies)[number];
export type RankingMetric = {
  id: Strategy;
  blockedOrders: number;
  urgentLateOrders: number;
  lateOrders: number;
  lateDays: number;
  plannedMinutes: number;
};
export const defaultRouterModel = "openai/gpt-4.1-mini";
export async function rankWithOpenRouter(
  env: Runtime,
  metrics: RankingMetric[],
) {
  if (!env.OPENROUTER_API_KEY) throw new Error("OpenRouter is not configured.");
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      ranking: {
        type: "array",
        minItems: metrics.length,
        maxItems: metrics.length,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            candidateId: { type: "string", enum: metrics.map((m) => m.id) },
            reason: { type: "string", maxLength: 240 },
          },
          required: ["candidateId", "reason"],
        },
      },
    },
    required: ["ranking"],
  };
  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(12000),
      body: JSON.stringify({
        model: env.OPENROUTER_MODEL || defaultRouterModel,
        stream: false,
        max_tokens: 1000,
        messages: [
          {
            role: "system",
            content:
              "Rank these validated production schedules. First minimize incompletely planned orders, then late urgent orders, late orders, late days, and finally maximize planned minutes. Return every candidate exactly once. Use only supplied aggregate metrics. Explain the tradeoffs briefly. Do not claim global optimality.",
          },
          { role: "user", content: JSON.stringify(metrics) },
        ],
        provider: { require_parameters: true, data_collection: "deny" },
        response_format: {
          type: "json_schema",
          json_schema: { name: "schedule_ranking", strict: true, schema },
        },
      }),
    },
  );
  if (!response.ok) {
    await response.arrayBuffer();
    throw new Error(`OpenRouter returned ${response.status}.`);
  }
  const raw = await readBody(response, 100000);
  const result = JSON.parse(raw) as {
    error?: unknown;
    choices?: Array<{
      error?: unknown;
      finish_reason?: string;
      message?: { refusal?: unknown; content?: unknown };
    }>;
  };
  const choice = result.choices?.[0];
  if (
    result.error ||
    result.choices?.length !== 1 ||
    !choice ||
    choice.error ||
    choice.finish_reason !== "stop" ||
    choice.message?.refusal ||
    typeof choice.message?.content !== "string"
  )
    throw new Error("OpenRouter did not return a complete ranking.");
  const ranking = z
    .object({
      ranking: z
        .array(
          z
            .object({
              candidateId: z.enum(scheduleStrategies),
              reason: z.string().min(1).max(240),
            })
            .strict(),
        )
        .length(metrics.length),
    })
    .strict()
    .parse(JSON.parse(choice.message.content)).ranking;
  if (
    new Set(ranking.map((r) => r.candidateId)).size !== metrics.length ||
    ranking.some((r) => !metrics.some((m) => m.id === r.candidateId))
  )
    throw new Error("OpenRouter returned an invalid candidate ranking.");
  return ranking;
}

export async function validMailgunSignature(
  key: string,
  signature: { timestamp: string; token: string; signature: string },
  now = Date.now(),
) {
  if (
    !/^\d{10}$/.test(signature.timestamp) ||
    Math.abs(now / 1000 - Number(signature.timestamp)) > 300 ||
    !/^[a-zA-Z0-9]{20,100}$/.test(signature.token) ||
    !/^[a-f0-9]{64}$/.test(signature.signature)
  )
    return false;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const bytes = Uint8Array.from(signature.signature.match(/.{2}/g)!, (part) =>
    parseInt(part, 16),
  );
  return crypto.subtle.verify(
    "HMAC",
    cryptoKey,
    bytes,
    new TextEncoder().encode(signature.timestamp + signature.token),
  );
}
