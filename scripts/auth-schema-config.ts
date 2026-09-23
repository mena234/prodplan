import { betterAuth } from "better-auth/minimal";
import { authOptions } from "../src/production/server/auth-options";
export const auth = betterAuth({ ...authOptions, baseURL: "http://127.0.0.1:3017", secret: "schema-generation-only-not-used-for-running-the-application" });
