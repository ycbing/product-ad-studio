import { spawnSync } from "node:child_process";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
const data = path.join(root, ".local/postgres");
await mkdir(path.dirname(data), { recursive: true });
const lookup = spawnSync("pg_config", ["--bindir"], { encoding: "utf8" });
const bin = process.env.PG_BIN || lookup.stdout?.trim();
if (!bin)
  throw Error(
    "Install PostgreSQL 14+ and set PG_BIN, or configure DATABASE_URL and run npm run db:migrate.",
  );
function run(name, args) {
  const r = spawnSync(path.join(bin, name), args, { stdio: "inherit" });
  if (r.status !== 0) throw Error(`${name} failed`);
}
let initialized = true;
try {
  await access(path.join(data, "PG_VERSION"));
} catch {
  initialized = false;
}
if (!initialized) {
  run("initdb", [
    "-D",
    data,
    "-U",
    "adstudio",
    "--auth-local=trust",
    "--auth-host=trust",
    "--encoding=UTF8",
    "--locale=C",
  ]);
  await writeFile(
    path.join(data, "postgresql.auto.conf"),
    "listen_addresses = '127.0.0.1'\nport = 55432\nunix_socket_directories = ''\n",
  );
}
if (
  spawnSync(path.join(bin, "pg_ctl"), ["-D", data, "status"], {
    stdio: "ignore",
  }).status !== 0
)
  run("pg_ctl", [
    "-D",
    data,
    "-l",
    path.join(root, ".local/postgres.log"),
    "-w",
    "start",
  ]);
const sql = spawnSync(
  path.join(bin, "psql"),
  [
    "-h",
    "127.0.0.1",
    "-p",
    "55432",
    "-U",
    "adstudio",
    "postgres",
    "-Atc",
    "SELECT 1 FROM pg_database WHERE datname='adstudio'",
  ],
  { encoding: "utf8" },
);
if (sql.status !== 0) throw Error(sql.stderr);
if (!sql.stdout.trim())
  run("createdb", [
    "-h",
    "127.0.0.1",
    "-p",
    "55432",
    "-U",
    "adstudio",
    "adstudio",
  ]);
console.log("Local PostgreSQL ready on 127.0.0.1:55432 (development only).");
