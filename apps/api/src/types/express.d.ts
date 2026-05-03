export interface AppRequestContext {
  /** Correlates logs and client retries; also sent as `x-request-id`. */
  requestId: string;
  /** ISO 8601 timestamp when context was created (start of request handling). */
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
