import { config } from "dotenv";
import path from "node:path";

// Repo root .env (see README); allow apps/api/.env to override when present.
// Must load before any module that reads process.env (e.g. db/pool).
config({ path: path.resolve(__dirname, "../../../.env") });
config({ path: path.resolve(__dirname, "../.env") });
