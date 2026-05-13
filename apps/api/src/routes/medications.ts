import { Router, type RequestHandler } from "express";
import { requireAuthContext } from "../middleware/auth";
import { resolveOrganizationContext } from "../middleware/organizationContext";
import { requireTenantMembership } from "../middleware/requireTenantMembership";
import { deleteMedicationHandler } from "../modules/medications/deleteMedication";
import { getMedicationHandler } from "../modules/medications/getMedication";
import { postMedicationHandler } from "../modules/medications/postMedication";
import { patchMedicationHandler, putMedicationHandler } from "../modules/medications/putMedication";

function medicationResourceRouter(): Router {
  const router = Router();
  router.post("/medications", postMedicationHandler);
  router.get("/medications/:id", getMedicationHandler);
  router.delete("/medications/:id", deleteMedicationHandler);
  router.put("/medications/:id", putMedicationHandler);
  router.patch("/medications/:id", patchMedicationHandler);
  return router;
}

/**
 * Mount meds routes behind an explicit auth chain:
 * Production: `requireAuthContext`, `resolveOrganizationContext`, `requireTenantMembership`.
 * Tests: stub auth + `resolveOrganizationContext` only (no Clerk JWT / no tenant membership middleware).
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
  resolveOrganizationContext,
  requireTenantMembership,
]);
