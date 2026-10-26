import { readdir, readFile } from "node:fs/promises";
import { pool, transaction } from "../lib/db";
export async function migrate() {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz DEFAULT now())",
  );
  for (const name of (await readdir("migrations"))
    .filter((x) => x.endsWith(".sql"))
    .sort()) {
    await transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(725101)");
      if (
        (await c.query("SELECT 1 FROM schema_migrations WHERE name=$1", [name]))
          .rowCount
      )
        return;
      await c.query(await readFile(`migrations/${name}`, "utf8"));
      await c.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
    });
  }
  console.log("Database migrations applied.");
}
if (process.argv[1]?.endsWith("migrate.ts")) {
  await migrate();
  await pool.end();
}
