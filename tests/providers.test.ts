import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emailReady,
  messageId,
  rankWithOpenRouter,
  sendMailgun,
  validMailgunSignature,
  type RankingMetric,
} from "../src/production/server/providers";
import type { Runtime } from "../src/production/server/runtime";
const mailEnv = {
  MAILGUN_API_KEY: "test-key",
  MAILGUN_DOMAIN: "mg.example.test",
  EMAIL_FROM: "ProdPlan <hello@mg.example.test>",
} as Runtime;
const mail = {
  id: "936709fa-b0fa-4458-87fe-a2a094ed60fe",
  recipient: "qa@example.test",
  subject: "Verification",
  body: "Test content",
};
const metrics: RankingMetric[] = [
  {
    id: "priority",
    blockedOrders: 0,
    urgentLateOrders: 0,
    lateOrders: 0,
    lateDays: 0,
    plannedMinutes: 60,
  },
  {
    id: "deadline",
    blockedOrders: 0,
    urgentLateOrders: 0,
    lateOrders: 0,
    lateDays: 0,
    plannedMinutes: 60,
  },
];
afterEach(() => vi.unstubAllGlobals());
describe("Mailgun delivery contract", () => {
  it.each(["us", "eu"])(
    "submits multipart messages to the %s region without assuming idempotency",
    async (region) => {
      const fetcher = vi.fn(async () =>
        Response.json({ id: messageId(mailEnv, mail.id) }),
      );
      vi.stubGlobal("fetch", fetcher);
      expect(
        await sendMailgun({ ...mailEnv, MAILGUN_REGION: region }, mail),
      ).toEqual({
        status: "accepted",
        providerId: messageId(mailEnv, mail.id),
      });
      const [url, options] = fetcher.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      expect(url).toBe(
        `https://${region === "eu" ? "api.eu" : "api"}.mailgun.net/v3/mg.example.test/messages`,
      );
      const headers = new Headers(options.headers);
      expect(headers.get("Authorization")).toBe(
        `Basic ${btoa("api:test-key")}`,
      );
      expect(headers.has("Content-Type")).toBe(false);
      expect(headers.has("Idempotency-Key")).toBe(false);
      const form = options.body as FormData;
      expect(form.get("to")).toBe(mail.recipient);
      expect(form.get("text")).toBe(mail.body);
      expect(form.get("o:tracking")).toBe("no");
      expect(form.get("v:outbox_id")).toBe(mail.id);
      const identifier = String(form.get("h:Message-Id")).replace(/^<|>$/g, "");
      expect(
        identifier.slice(
          "prodplan-".length,
          -`@${mailEnv.MAILGUN_DOMAIN}`.length,
        ),
      ).toBe(mail.id);
    },
  );
  it.each([
    [429, "retry"],
    [400, "failed"],
    [401, "failed"],
    [403, "failed"],
    [500, "uncertain"],
    [408, "uncertain"],
  ])("classifies HTTP %s as %s", async (code, status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("Provider error", { status: Number(code) }),
      ),
    );
    expect((await sendMailgun(mailEnv, mail)).status).toBe(status);
  });
  it("does not automatically retry an ambiguous submission", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("Network disconnected");
    });
    vi.stubGlobal("fetch", fetcher);
    expect((await sendMailgun(mailEnv, mail)).status).toBe("uncertain");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("makes no request for missing or unsafe configuration", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(emailReady({ ...mailEnv, MAILGUN_REGION: "elsewhere" })).toBe(false);
    expect(
      (await sendMailgun({ ...mailEnv, MAILGUN_DOMAIN: "invalid/path" }, mail))
        .status,
    ).toBe("failed");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("requires an authentic, recent webhook signature", async () => {
    const now = Date.now(),
      signature = {
        timestamp: String(Math.floor(now / 1000)),
        token: "a".repeat(50),
        signature: "",
      },
      key = "local-test-signing-key";
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(key),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    signature.signature = Array.from(
      new Uint8Array(
        await crypto.subtle.sign(
          "HMAC",
          cryptoKey,
          new TextEncoder().encode(signature.timestamp + signature.token),
        ),
      ),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    expect(await validMailgunSignature(key, signature, now)).toBe(true);
    expect(await validMailgunSignature("wrong-key", signature, now)).toBe(
      false,
    );
    expect(await validMailgunSignature(key, signature, now + 301000)).toBe(
      false,
    );
    expect(
      await validMailgunSignature(
        key,
        { ...signature, token: "tampered" },
        now,
      ),
    ).toBe(false);
  });
});
describe("OpenRouter ranking boundary", () => {
  const ranking = metrics.map((m) => ({
    candidateId: m.id,
    reason: "Both candidates meet the entered constraints.",
  }));
  it("sends aggregate metrics with a strict response schema", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify({ ranking }) },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    expect(
      await rankWithOpenRouter(
        { OPENROUTER_API_KEY: "test-key" } as Runtime,
        metrics,
      ),
    ).toEqual(ranking);
    const [url, options] = fetcher.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ],
      body = JSON.parse(options.body as string);
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(body.model).toBe("openai/gpt-4.1-mini");
    expect(body.provider).toEqual({
      require_parameters: true,
      data_collection: "deny",
    });
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(JSON.parse(body.messages[1].content)).toEqual(metrics);
    expect(body.max_output_tokens).toBeUndefined();
  });
  it.each(["length", "content_filter", "error"])(
    "rejects incomplete responses (%s)",
    async (reason) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json({
            choices: [
              {
                finish_reason: reason,
                message: { content: JSON.stringify({ ranking }) },
              },
            ],
          }),
        ),
      );
      await expect(
        rankWithOpenRouter({ OPENROUTER_API_KEY: "test" } as Runtime, metrics),
      ).rejects.toThrow("complete ranking");
    },
  );
  it.each([
    JSON.stringify({ ranking: [ranking[0], ranking[0]] }),
    JSON.stringify({
      ranking: [
        ranking[0],
        { candidateId: "material", reason: "Not a supplied candidate" },
      ],
    }),
    "bad JSON",
  ])("rejects an invalid ranking: %s", async (content) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          choices: [{ finish_reason: "stop", message: { content } }],
        }),
      ),
    );
    await expect(
      rankWithOpenRouter({ OPENROUTER_API_KEY: "test" } as Runtime, metrics),
    ).rejects.toThrow();
  });
  it("does not call an unconfigured provider", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(rankWithOpenRouter({} as Runtime, metrics)).rejects.toThrow(
      "not configured",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
