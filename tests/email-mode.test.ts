import { afterEach, expect, it, vi } from "vitest";
import {
  enqueueMail,
  flushMail,
  localEmailCapture,
} from "../src/production/server/mail";
import { emailReady, sendMailgun } from "../src/production/server/providers";
import { isEmailDisabled } from "../src/production/server/email-mode";
import type { Runtime } from "../src/production/server/runtime";
afterEach(() => vi.unstubAllGlobals());
it("does not interpret missing configuration as permission to bypass email verification", () => {
  expect(isEmailDisabled({})).toBe(false);
  expect(isEmailDisabled({ EMAIL_DISABLED: "0" })).toBe(false);
  expect(isEmailDisabled({ EMAIL_DISABLED: "true" })).toBe(false);
});
it("suppresses mail and local capture even with working-looking provider settings", async () => {
  const prepare = vi.fn(),
    fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const env = {
    EMAIL_DISABLED: "1",
    AUTH_EMAIL_CAPTURE: "1",
    BETTER_AUTH_URL: "http://127.0.0.1:3018",
    MAILGUN_API_KEY: "test",
    MAILGUN_DOMAIN: "mg.example.test",
    EMAIL_FROM: "test@mg.example.test",
    DB: { prepare },
  } as unknown as Runtime;
  expect(emailReady(env)).toBe(false);
  expect(localEmailCapture(env)).toBe(false);
  await enqueueMail(env, "qa@example.test", "Subject", "Body");
  await flushMail(env);
  expect(
    (
      await sendMailgun(env, {
        id: crypto.randomUUID(),
        recipient: "qa@example.test",
        subject: "Test",
        body: "Test",
      })
    ).status,
  ).toBe("failed");
  expect(fetcher).not.toHaveBeenCalled();
  expect(prepare).not.toHaveBeenCalled();
});
