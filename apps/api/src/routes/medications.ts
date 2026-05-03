import { Router } from "express";
import { requireAuthContext } from "../middleware/auth";
import { requireOrganizationContext } from "../middleware/organizationContext";
import { putMedicationHandler } from "../modules/medications/putMedication";

const router = Router();

router.use(requireAuthContext);
router.use(requireOrganizationContext);

router.put("/medications/:id", putMedicationHandler);

export { router as medicationsApiRouter };
