export interface Runtime {
  DB: D1Database;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  MAILGUN_API_KEY?: string;
  MAILGUN_DOMAIN?: string;
  MAILGUN_REGION?: string;
  MAILGUN_WEBHOOK_SIGNING_KEY?: string;
  EMAIL_FROM?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  CRON_SECRET?: string;
  AUTH_EMAIL_CAPTURE?: string;
  EMAIL_DISABLED?: string;
}
// Both real accounts and temporary demo sessions use the same Sites runtime.
export function getRuntime(): Runtime {
  throw new Error(
    "The full platform requires the Sites runtime. Start the Sites preview.",
  );
}
