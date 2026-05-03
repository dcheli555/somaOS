import { pool } from "../src/client.js";

try {
  const { rows } = await pool.query<{
    database: string;
    user: string;
  }>("SELECT current_database() AS database, current_user AS user");
  console.log("Postgres connection OK:", rows[0]);
} catch (err) {
  console.error("Connection failed:", err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
