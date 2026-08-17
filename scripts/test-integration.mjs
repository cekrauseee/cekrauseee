import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadLocalEnvironment } from "./local-environment.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
await loadLocalEnvironment();

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    "TEST_DATABASE_URL is required; refusing to run integration tests.",
  );
}

const result = spawnSync(
  process.execPath,
  ["node_modules/vitest/vitest.mjs", "run"],
  {
    cwd: root,
    env: { ...process.env, VITEST_INTEGRATION: "1" },
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
