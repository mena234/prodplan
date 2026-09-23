import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import path from "node:path";
const databaseDir = path.resolve(".data/postgres");
const pg = new EmbeddedPostgres({
  databaseDir,
  user: "prodplan",
  password: "prodplan_local_demo",
  port: 55432,
  persistent: true,
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => {},
  onError: (message) => console.error(String(message)),
});
if (!existsSync(path.join(databaseDir, "PG_VERSION"))) await pg.initialise();
await pg.start();
const client = pg.getPgClient();
await client.connect();
const found = await client.query(
  "SELECT 1 FROM pg_database WHERE datname = $1",
  ["prodplan"],
);
if (!found.rowCount) await pg.createDatabase("prodplan");
await client.end();
console.log(
  "ProdPlan PostgreSQL ready on 127.0.0.1:55432. Data is persisted in .data/postgres.",
);
const timer = setInterval(() => {}, 60000);
async function stop() {
  clearInterval(timer);
  await pg.stop();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
