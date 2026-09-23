import { defineConfig } from "vite";
import vinext from "vinext";
import { sites } from "@openai/sites-vite-plugin";
import { resolve } from "node:path";
export default defineConfig(async () => {
  process.env.WRANGLER_WRITE_LOGS = "false";
  process.env.WRANGLER_LOG_PATH = ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH = ".wrangler/registry";
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  return {
    plugins: [
      {
        name: "prodplan-sites-persistence",
        enforce: "pre",
        load(id: string) {
          if (
            id.replaceAll("\\", "/") ===
            resolve("src/production/server/runtime.ts").replaceAll("\\", "/")
          )
            return 'export * from "../../../sites/runtime";';
        },
      },
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: {
          name: "prodplan",
          main: "./worker/index.ts",
          compatibility_date: "2026-09-01",
          compatibility_flags: ["nodejs_compat"],
          triggers: { crons: ["*/15 * * * *"] },
          d1_databases: [
            {
              binding: "DB",
              database_name: "prodplan-local-sites",
              database_id: "00000000-0000-4000-8000-000000000000",
              migrations_dir: "drizzle",
            },
          ],
        },
      }),
    ],
  };
});
