import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { parse } from "pg-connection-string";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../../.env") });
config({ path: resolve(__dirname, "../.env") });

const MAINT_DB = process.env.POSTGRES_MAINTENANCE_DATABASE ?? "postgres";

/** Restrict to names safe as a double-quoted Postgres identifier (avoid SQL injection via URL). */
const SAFE_DB_NAME = /^[a-zA-Z][a-zA-Z0-9_-]{0,62}$/;

function quotedIdentifier(name: string): string {
  if (!SAFE_DB_NAME.test(name)) {
    throw new Error(
      `Refusing CREATE DATABASE for unsafe identifier "${name}" (allowed: letter + alphanumeric, underscore, hyphen; max 63 chars).`,
    );
  }
  return `"${name.replace(/"/g, '""')}"`;
}

function maintenanceClientConfig(
  parsed: ReturnType<typeof parse>,
  maintDatabase: string,
): pg.ClientConfig {
  const ssl = parsed.ssl;
  const cfg: pg.ClientConfig = {
    user: parsed.user,
    password: parsed.password ?? undefined,
    host: parsed.host ?? undefined,
    port: parsed.port !== undefined ? Number(parsed.port) : undefined,
    database: maintDatabase,
  };
  if (ssl !== undefined && ssl !== null && ssl !== false) {
    cfg.ssl = ssl as pg.ClientConfig["ssl"];
  }
  return cfg;
}

async function run(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString?.trim()) {
    throw new Error("DATABASE_URL is not set");
  }

  const parsed = parse(connectionString.trim());
  const dbName = parsed.database?.trim();
  if (!dbName) {
    throw new Error("DATABASE_URL must include a database path (…/dbname).");
  }

  if (dbName === MAINT_DB) {
    console.log(`Target database is "${MAINT_DB}"; nothing to ensure.`);
    return;
  }

  const maint = new pg.Client(maintenanceClientConfig(parsed, MAINT_DB));

  await maint.connect();
  try {
    const { rows } = await maint.query<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_database WHERE datname = $1::text) AS exists`,
      [dbName],
    );

    if (rows[0]?.exists) {
      console.log(`Database "${dbName}" already exists.`);
      return;
    }

    const qid = quotedIdentifier(dbName);
    await maint.query(`CREATE DATABASE ${qid}`);
    console.log(`Created database "${dbName}".`);
  } finally {
    await maint.end();
  }
}

await run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
