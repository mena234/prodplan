import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
// Local QA only. A read-only connection avoids running a second D1 emulator
// against the same database while the preview server is writing.
const folder = path.resolve(".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
const files = fs
  .readdirSync(folder)
  .filter((name) => /^[a-f0-9]{64}\.sqlite$/.test(name));
if (files.length !== 1)
  throw new Error("Expected one local ProdPlan test database.");
export const testDb = new DatabaseSync(path.join(folder, files[0]), {
  readOnly: true,
});
testDb.exec("PRAGMA busy_timeout=5000");
