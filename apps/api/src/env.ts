import { config } from "dotenv";
import path from "node:path";

// Repo root .env (see README); allow apps/api/.env to override when present.
// Must load before any module that reads process.env (e.g. db/pool).
config({ path: path.resolve(__dirname, "../../../.env") });
config({ path: path.resolve(__dirname, "../.env") });

/** Clerk expects `CLERK_PUBLISHABLE_KEY`; Next.js tutorials use NEXT_PUBLIC_* — normalize for Express. */
if (
  !process.env.CLERK_PUBLISHABLE_KEY?.trim() &&
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim()
) {
  process.env.CLERK_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.trim();
}
