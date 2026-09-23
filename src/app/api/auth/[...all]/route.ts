import { auth } from "@/production/server/auth";
import { getRuntime } from "@/production/server/runtime";
import { emailReady, localEmailCapture } from "@/production/server/mail";
import { readBody, HttpError } from "@/production/server/http";
import { isEmailDisabled } from "@/production/server/email-mode";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  try {
    request = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.method === "POST"
        ? { body: await readBody(request, 65536) }
        : {}),
    });
    const env = getRuntime();
    const path = new URL(request.url).pathname;
    if (
      isEmailDisabled(env) &&
      /\/api\/auth\/(request-password-reset|send-verification-email|reset-password|verify-email|change-email)(\/|$)/.test(
        path,
      )
    ) {
      return Response.json(
        {
          message:
            "Email is temporarily disabled. Email verification and password reset emails are unavailable.",
        },
        { status: 503 },
      );
    }
    if (
      request.method === "POST" &&
      /\/(sign-up\/email|request-password-reset|send-verification-email)$/.test(
        new URL(request.url).pathname,
      ) &&
      !isEmailDisabled(env) &&
      !emailReady(env) &&
      !localEmailCapture(env)
    ) {
      await request.arrayBuffer().catch(() => undefined);
      return Response.json(
        {
          message:
            "Email delivery is not configured yet. Please contact the workspace administrator.",
        },
        { status: 503 },
      );
    }
    return await auth().handler(request);
  } catch (error) {
    if (error instanceof HttpError)
      return Response.json(
        { message: error.message },
        { status: error.status },
      );
    console.error(
      "Authentication service failed",
      error instanceof Error ? error.message : "Unknown error",
    );
    return Response.json(
      {
        message:
          "Account service is temporarily unavailable. Please try again.",
      },
      { status: 503 },
    );
  }
}
export const GET = handle;
export const POST = handle;
