import type { BetterAuthOptions } from "better-auth";
export const AUTH_LINK_TTL_SECONDS = 3600;
export const authOptions = {
  appName: "ProdPlan",
  basePath: "/api/auth",
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: AUTH_LINK_TTL_SECONDS,
  },
  emailVerification: { sendOnSignUp: true, expiresIn: AUTH_LINK_TTL_SECONDS },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: false },
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 60, max: 5 },
      "/request-password-reset": { window: 60, max: 3 },
    },
  },
  advanced: {
    database: { generateId: "uuid" },
    ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
  },
} satisfies BetterAuthOptions;
