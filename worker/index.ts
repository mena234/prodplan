import handler from "vinext/server/app-router-entry";
import { flushMail } from "../src/production/server/mail";
import type { Runtime } from "../src/production/server/runtime";
import {
  cleanupDemos,
  demoRequest,
} from "../src/production/server/demo-session";
const worker = {
  async fetch(
    request: Request,
    env: NonNullable<Parameters<typeof handler.fetch>[1]>,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (
      ["/", "/app", "/login"].includes(url.pathname) ||
      url.pathname.startsWith("/api/")
    )
      ctx.waitUntil(
        cleanupDemos(env as unknown as Runtime).catch((e) =>
          console.error(
            "Demo cleanup failed",
            e instanceof Error ? e.message : "Unknown error",
          ),
        ),
      );
    const response = await handler.fetch(request, env, ctx);
    if (
      !demoRequest(request.headers) &&
      url.searchParams.get("demo") !== "1" &&
      (url.pathname.startsWith("/api/auth/") ||
        url.pathname.startsWith("/api/platform/"))
    )
      ctx.waitUntil(
        flushMail(env as unknown as Runtime).catch((error) =>
          console.error(
            "Email queue processing failed",
            error instanceof Error ? error.message : "Unknown error",
          ),
        ),
      );
    if (
      url.pathname === "/" ||
      url.pathname === "/app" ||
      url.pathname === "/login" ||
      url.pathname.startsWith("/api/")
    ) {
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "private, no-store");
      headers.set("Vary", "Cookie");
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("X-Frame-Options", "DENY");
      headers.set("Referrer-Policy", "same-origin");
      headers.set(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=(), payment=()",
      );
      if (url.protocol === "https:")
        headers.set("Strict-Transport-Security", "max-age=31536000");
      headers.set(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
      );
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
    return response;
  },
  async scheduled(
    _event: ScheduledController,
    env: Runtime,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(cleanupDemos(env));
  },
};
export default worker;
