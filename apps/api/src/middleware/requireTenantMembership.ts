import type { RequestHandler } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import {
  orgMetadataTenantKeyFromEnv,
  userMembershipAllowsTenant,
} from "../clerk/verifyTenantMembership";
import { sendMedicationApiError } from "../modules/medications/medicationApiError";

function isLikelyTransientClerkError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = (err as { status?: unknown }).status;
  return typeof status === "number" && status >= 500;
}

/**
 * After `requireAuthContext` + `requireOrganizationContext`, ensures `X-Organization-Id`
 * is backed by Clerk **organization membership** (Backend API), not only the active JWT org.
 *
 * — `org_…` header: user must be in that Clerk organization (`organizations.getOrganizationMembershipList`).
 * — UUID header: user's organizations are scanned (`users.getOrganizationMembershipList`, paginated) until one
 *   has matching `organization.public_metadata[CLERK_ORG_METADATA_TENANT_KEY]` (default `tenant_uuid`).
 *
 * When the header equals the session's active `org_id` (`org_…` only), the Backend API membership call is skipped.
 */
export const requireTenantMembership: RequestHandler = async (
  req,
  res,
  next,
) => {
  const organizationId = req.context.organizationId;
  if (!organizationId) {
    sendMedicationApiError(
      res,
      500,
      "INTERNAL_ERROR",
      "Organization context not initialized",
      req.context.requestId,
    );
    return;
  }

  const auth = getAuth(req);
  if (!auth.userId) {
    sendMedicationApiError(
      res,
      401,
      "UNAUTHORIZED",
      "Unauthorized",
      req.context.requestId,
    );
    return;
  }

  try {
    if (
      organizationId.startsWith("org_") &&
      auth.orgId === organizationId
    ) {
      next();
      return;
    }

    const allowed = await userMembershipAllowsTenant(clerkClient, {
      userId: auth.userId,
      tenantIdHeader: organizationId,
      metadataKey: orgMetadataTenantKeyFromEnv(),
    });

    if (!allowed) {
      sendMedicationApiError(
        res,
        403,
        "TENANT_ACCESS_DENIED",
        "X-Organization-Id is not authorized for this user.",
        req.context.requestId,
      );
      return;
    }

    next();
  } catch (err) {
    const transient = isLikelyTransientClerkError(err);
    sendMedicationApiError(
      res,
      transient ? 503 : 500,
      transient ? "TENANT_VERIFICATION_UNAVAILABLE" : "INTERNAL_ERROR",
      transient
        ? "Could not verify organization membership with Clerk."
        : "Tenant membership verification failed.",
      req.context.requestId,
    );
  }
};
