export interface AppRequestContext {
  /**
   * End-to-end correlation (from `X-Correlation-Id` when provided, otherwise generated).
   * Echoed as `x-correlation-id` on the response.
   */
  correlationId: string;
  /** Unique id for this single API invocation; echoed as `x-request-id` on the response. */
  requestId: string;
  /** UTC ISO 8601 timestamp when context was created (start of request handling). */
  timestamp: string;

  /**
   * Internal tenant id: `organizations.id` (UUID). Vendor-neutral FK used for all domain SQL.
   * `null` until `resolveOrganizationContext` resolves `X-Organization-Id`.
   */
  organizationId: string | null;

  /**
   * Clerk (or similarly prefixed) external org key stored in `organizations.clerk_organization_id`.
   * Used for Clerk membership checks; domain tables MUST NOT query by this value alone.
   * `null` until organization context is resolved.
   */
  clerkOrganizationId: string | null;
}

export {};

declare global {
  namespace Express {
    interface Request {
      /** Populated by `requestContextMiddleware` then `resolveOrganizationContext` on tenant routes. */
      context: AppRequestContext;
      /** Set by `requireAuthContext` after a valid Clerk session (see `userId`). */
      authContext?: {
        userId: string;
      };
    }
  }
}
