import { env } from "cloudflare:workers";
import type { Runtime } from "../src/production/server/runtime";
export function getRuntime(): Runtime { return env as unknown as Runtime; }
