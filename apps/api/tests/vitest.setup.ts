import { config } from "dotenv";
import path from "node:path";

// Before any `src` module loads `db/pool` (which requires DATABASE_URL).
config({ path: path.resolve(__dirname, "../../../.env") });
config({ path: path.resolve(__dirname, "../.env") });
