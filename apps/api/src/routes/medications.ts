import { Router, type RequestHandler } from "express";
import { requireAuthContext } from "../middleware/auth";
import { requireOrganizationContext } from "../middleware/organizationContext";
import { requireTenantMembership } from "../middleware/requireTenantMembership";
import { deleteMedicationHandler } from "../modules/medications/deleteMedication";
import { getMedicationHandler } from "../modules/medications/getMedication";
import { postMedicationHandler } from "../modules/medications/postMedication";
import { putMedicationHandler } from "../modules/medications/putMedication";

function medicationResourceRouter(): Router {
  const router = Router();
  router.post("/medications", postMedicationHandler);
  router.get("/medications/:id", getMedicationHandler);
  router.delete("/medications/:id", deleteMedicationHandler);
  router.put("/medications/:id", putMedicationHandler);
  return router;
}

/**
 * Mount meds routes behind an explicit auth chain:
 * Production: Clerk {@link requireAuthContext}, org header parsing, {@link requireTenantMembership}.
 * Tests: stub auth + org header only (no Clerk JWT — omit {@link requireTenantMembership}).
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
  requireTenantMembership,
]);
