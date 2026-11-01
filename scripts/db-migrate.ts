// Creates all tables (sync, users, OAuth). Safe to re-run. Run: pnpm db:migrate (needs DATABASE_URL).
import fs from "node:fs";
import { getPool } from "../src/server/db";

async function main() {
  await getPool().query(fs.readFileSync("src/server/schema.sql", "utf8"));
  await getPool().end();
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
