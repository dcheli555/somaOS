import type { RequestHandler } from "express";
import express from "express";
import { pool } from "../src/db/pool";
import { requireOrganizationContext } from "../src/middleware/organizationContext";
import { requestContextMiddleware } from "../src/middleware/requestContext";
import { createMedicationsApiRouter } from "../src/routes/medications";

/** Stable id for audit + handler checks; not a real Clerk user. */
export const TEST_ACTOR_USER_ID = "user_integration_test";

const testRequireAuth: RequestHandler = (req, _res, next) => {
  req.authContext = { userId: TEST_ACTOR_USER_ID };
  next();
};

/**
 * Medications API only (no Clerk): same handlers as production, with a stub `requireAuth`.
 */
export function createMedicationsIntegrationApp() {
  const app = express();
  app.use(requestContextMiddleware);
  app.use(express.json());
  app.use(
    "/api",
    createMedicationsApiRouter([testRequireAuth, requireOrganizationContext]),
  );
  return app;
}

export { pool };
