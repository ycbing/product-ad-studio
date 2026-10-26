import { spawn } from "node:child_process";
const children = [];
function run(args, wait = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      stdio: "inherit",
      env: process.env,
    });
    children.push(child);
    child.on("error", reject);
    if (wait)
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(Error(`Process failed (${code})`)),
      );
    else resolve(child);
  });
}
await run(["--import", "tsx", "scripts/migrate.ts"], true);
await run(["--import", "tsx", "scripts/seed.ts"], true);
await run(["--import", "tsx", "worker/main.ts"]);
await run([
  "node_modules/next/dist/bin/next",
  "dev",
  "--hostname",
  "127.0.0.1",
  "--port",
  "3100",
]);
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children)
    if (child.exitCode === null) child.kill("SIGTERM");
  setTimeout(() => process.exit(), 1000).unref();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
