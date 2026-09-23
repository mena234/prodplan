import type { Runtime } from "./runtime";

// Explicit temporary mode. Missing credentials alone must never weaken auth.
export function isEmailDisabled(env: Pick<Runtime, "EMAIL_DISABLED">) {
  return env.EMAIL_DISABLED === "1";
}
