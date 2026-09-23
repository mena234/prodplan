import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/auth-schema";
import { authOptions } from "./auth-options";
import { getRuntime } from "./runtime";
import { enqueueMail } from "./mail";
import { isEmailDisabled } from "./email-mode";

export function auth() {
  const env = getRuntime();
  if (!env.BETTER_AUTH_SECRET || !env.BETTER_AUTH_URL)
    throw new Error("Account service is not configured yet.");
  return betterAuth({
    ...authOptions,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [env.BETTER_AUTH_URL],
    database: drizzleAdapter(drizzle(env.DB, { schema }), {
      provider: "sqlite",
      schema,
      transaction: false,
    }),
    emailAndPassword: {
      ...authOptions.emailAndPassword,
      requireEmailVerification: !isEmailDisabled(env),
      sendResetPassword: async ({ user, url }) => {
        await enqueueMail(
          env,
          user.email,
          "Reset your ProdPlan password",
          `Reset your password using this link:\n\n${url}\n\nIf you did not request this, you can ignore this email.`,
        );
      },
    },
    emailVerification: {
      ...authOptions.emailVerification,
      sendOnSignUp: !isEmailDisabled(env),
      sendOnSignIn: false,
      sendVerificationEmail: async ({ user, url }) => {
        await enqueueMail(
          env,
          user.email,
          "Verify your ProdPlan email",
          `Welcome to ProdPlan. Verify your email to open your production workspace:\n\n${url}\n\nIf you did not create an account, you can ignore this email.`,
        );
      },
    },
  });
}
