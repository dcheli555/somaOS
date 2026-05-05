import { Router, type RequestHandler } from "express";
import { requireAuthContext } from "../middleware/auth";
import { requireOrganizationContext } from "../middleware/organizationContext";
import { putMedicationHandler } from "../modules/medications/putMedication";

function medicationResourceRouter(): Router {
  const router = Router();
  router.put("/medications/:id", putMedicationHandler);
  return router;
}

/**
 * Mount meds routes behind an explicit auth chain (Clerk {@link requireAuthContext} in production,
 * or a test stub that sets `req.authContext`).
 */
export function createMedicationsApiRouter(
  authChain: RequestHandler[],
): Router {
  const router = Router();
  for (const mw of authChain) {
    router.use(mw);
  }
  router.use(medicationResourceRouter());
  return router;
}

export const medicationsApiRouter = createMedicationsApiRouter([
  requireAuthContext,
  requireOrganizationContext,
]);
