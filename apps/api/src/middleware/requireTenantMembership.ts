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
 * After `requireAuthContext` + `resolveOrganizationContext`, verifies the authenticated
 * user belongs to this tenant according to Clerk.
 *
 * — Real Clerk `org_*` stored on the row → membership on that Clerk org (Backend API shortcut when active session org matches header).
 * — Otherwise (e.g. `legacy:*` binds or future non-Clerk keys) → scan memberships comparing `organizationId` UUID to metadata.
 */
export const requireTenantMembership: RequestHandler = async (
  req,
  res,
  next,
) => {
  const organizationId = req.context.organizationId;
  const clerkOrganizationId = req.context.clerkOrganizationId;

  if (!organizationId || !clerkOrganizationId) {
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
      clerkOrganizationId.startsWith("org_") &&
      auth.orgId === clerkOrganizationId
    ) {
      next();
      return;
    }

    let allowed: boolean;
    if (clerkOrganizationId.startsWith("org_")) {
      allowed = await userMembershipAllowsTenant(clerkClient, {
        userId: auth.userId,
        tenantIdHeader: clerkOrganizationId,
        metadataKey: orgMetadataTenantKeyFromEnv(),
      });
    } else {
      allowed = await userMembershipAllowsTenant(clerkClient, {
        userId: auth.userId,
        tenantIdHeader: organizationId,
        metadataKey: orgMetadataTenantKeyFromEnv(),
      });
    }

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
