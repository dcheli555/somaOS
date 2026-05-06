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
   * Active organization for this request, when multi-tenant resolution exists.
   * `null` until org scoping is implemented.
   */
  organizationId: string | null;
}

export {};

declare global {
  namespace Express {
    interface Request {
      /** Populated by `requestContextMiddleware` for every request. */
      context: AppRequestContext;
      /** Set by `requireAuthContext` after a valid Clerk session (see `userId`). */
      authContext?: {
        userId: string;
      };
    }
  }
}
