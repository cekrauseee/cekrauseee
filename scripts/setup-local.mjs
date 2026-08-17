import { access, chmod, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const envPath = resolve(root, ".env.local");
const envExamplePath = resolve(root, ".env.example");
const defaultDatabaseUrl =
  "postgresql://postgres:postgres@localhost:5432/shell";
const args = new Set(process.argv.slice(2));
const skipDependencies = args.has("--skip-dependencies");
const skipDatabase = args.has("--skip-database");

if (args.has("--help")) {
  console.log(`Usage: npm run setup:local -- [options]

Options:
  --skip-dependencies  Do not run npm ci.
  --skip-database      Do not start PostgreSQL or push the schema.
  --help               Show this help message.`);
  process.exit(0);
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function readEnvironment(source) {
  const values = new Map();

  for (const line of source.split(/\r?\n/u)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/u);
    if (match) values.set(match[1], match[2]);
  }

  return values;
}

function replaceEnvironmentValue(source, key, value) {
  const line = `${key}=${value}`;
  const expression = new RegExp(`^${key}=.*$`, "mu");

  return expression.test(source)
    ? source.replace(expression, line)
    : `${source.trimEnd()}\n${line}\n`;
}

function isPlaceholder(value) {
  return !value || value.startsWith("replace-with-");
}

function run(command, commandArgs, environment) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    env: environment,
    stdio: "inherit",
  });

  if (result.error) {
    throw new Error(`Could not run ${command}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} failed.`);
  }
}

async function prepareEnvironment() {
  const source = await readFile(
    (await exists(envPath)) ? envPath : envExamplePath,
    "utf8",
  );
  const values = readEnvironment(source);
  const databaseUrl = isPlaceholder(values.get("DATABASE_URL"))
    ? defaultDatabaseUrl
    : values.get("DATABASE_URL");
  const sessionSecret = isPlaceholder(values.get("SESSION_SECRET"))
    ? randomBytes(32).toString("base64url")
    : values.get("SESSION_SECRET");
  const updated = replaceEnvironmentValue(
    replaceEnvironmentValue(source, "DATABASE_URL", databaseUrl),
    "SESSION_SECRET",
    sessionSecret,
  );

  await writeFile(envPath, updated, { mode: 0o600 });
  await chmod(envPath, 0o600);
  console.log(
    "Prepared .env.local with local PostgreSQL settings and a session secret.",
  );

  return {
    ...process.env,
    DATABASE_URL: databaseUrl,
    SESSION_SECRET: sessionSecret,
  };
}

const environment = await prepareEnvironment();

if (!skipDependencies) run("npm", ["ci"], environment);

if (skipDatabase) {
  console.log("Skipped PostgreSQL startup and schema push.");
  process.exit(0);
}

try {
  run("docker", ["compose", "up", "-d", "postgres"], environment);
  run(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "sh",
      "-c",
      "until pg_isready -U postgres -d shell; do sleep 1; done",
    ],
    environment,
  );
} catch (error) {
  console.error(
    "PostgreSQL could not start. Start Docker or OrbStack, then rerun npm run setup:local.",
  );
  throw error;
}

run("npm", ["run", "db:push"], environment);
console.log("Local shell setup is complete. Run npm run dev to start the app.");
