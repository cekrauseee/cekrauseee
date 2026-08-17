import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadLocalEnvironment } from "./local-environment.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
await loadLocalEnvironment();

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    "TEST_DATABASE_URL is required; refusing to push a test schema.",
  );
}

const result = spawnSync(
  process.execPath,
  // The target is the disposable TEST_DATABASE_URL. CI has no TTY, so approve
  // the schema creation explicitly rather than leaving Drizzle at its prompt.
  ["node_modules/drizzle-kit/bin.cjs", "push", "--force"],
  {
    cwd: root,
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
