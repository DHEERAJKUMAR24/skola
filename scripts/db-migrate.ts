// Creates the sync table and Better Auth tables. Run: pnpm db:migrate (needs DATABASE_URL).
import fs from "node:fs";
import { getMigrations } from "better-auth/db/migration";
import { getAuth } from "../src/server/auth";
import { getPool } from "../src/server/db";

async function main() {
  await getPool().query(fs.readFileSync("src/server/schema.sql", "utf8"));
  const { runMigrations, toBeCreated, toBeAdded } = await getMigrations(
    getAuth().options
  );
  console.log(
    `auth tables to create: ${toBeCreated.length}, to alter: ${toBeAdded.length}`
  );
  await runMigrations();
  await getPool().end();
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
