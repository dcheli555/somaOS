import pg from "pg";

/** Lazily create Pool so Vitest setupFiles can load DATABASE_URL before the first DB call. */
let poolInstance: pg.Pool | undefined;

export function createPoolOnce(): pg.Pool {
  if (!poolInstance) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    poolInstance = new pg.Pool({ connectionString });
  }
  return poolInstance;
}

export type DbClient = pg.PoolClient;

export const pool: pg.Pool = new Proxy({} as pg.Pool, {
  get(_target, prop: string | symbol, receiver): unknown {
    const actual = createPoolOnce();
    const raw = Reflect.get(actual, prop, receiver);
    return typeof raw === "function"
      ? (raw as (...args: unknown[]) => unknown).bind(actual)
      : raw;
  },
}) as pg.Pool;

export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await createPoolOnce().connect();
  try {
    await client.query("BEGIN");
    try {
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  } finally {
    client.release();
  }
}
