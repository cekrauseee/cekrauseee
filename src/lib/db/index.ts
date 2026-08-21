import "server-only";

import { neonConfig, Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import type { NeonDatabase } from "drizzle-orm/neon-serverless";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import ws from "ws";

import * as schema from "./schema";

export type Database =
  NeonDatabase<typeof schema> | NodePgDatabase<typeof schema>;

let database: Database | undefined;
let postgresPool: Pool | undefined;
let neonPool: NeonPool | undefined;

export type DatabaseDriver = "neon-serverless" | "node-postgres";

export function selectDatabaseDriver(
  env: { VERCEL?: string } | NodeJS.ProcessEnv = process.env,
): DatabaseDriver {
  return env.VERCEL === "1" ? "neon-serverless" : "node-postgres";
}

/**
 * Create the driver only when an action is invoked. This keeps `next build`
 * usable without a DATABASE_URL and avoids opening a pool during prerendering.
 */
export function getDb(): Database {
  if (database) return database;

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");

  if (selectDatabaseDriver() === "neon-serverless") {
    // Neon Pool provides real transaction semantics over WebSockets, which
    // the workspace command path needs for row locks and atomic snapshots.
    neonConfig.webSocketConstructor = ws;
    neonPool = new NeonPool({ connectionString: url, max: 4 });
    database = drizzleNeon(neonPool, { schema });
  } else {
    postgresPool = new Pool({ connectionString: url, max: 4 });
    database = drizzlePg(postgresPool, { schema });
  }

  return database;
}

export async function closeDbForTests() {
  if (postgresPool) {
    await postgresPool.end();
    postgresPool = undefined;
    database = undefined;
  }
  if (neonPool) {
    await neonPool.end();
    neonPool = undefined;
    database = undefined;
  }
}
