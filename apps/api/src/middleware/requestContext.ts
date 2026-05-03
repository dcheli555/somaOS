import type { RequestHandler } from "express";
import { randomUUID } from "node:crypto";

export const REQUEST_ID_HEADER = "x-request-id";

/**
 * Ensures each request has a stable `req.context` (requestId, timestamp, organizationId)
 * and echoes `requestId` on the response as `x-request-id`.
 *
 * Mount early in the Express stack (before auth and route handlers).
 */
export const requestContextMiddleware: RequestHandler = (req, res, next) => {
  const requestId = randomUUID();
  const timestamp = new Date().toISOString();
  const organizationId = null;

  req.context = {
    requestId,
    timestamp,
    organizationId,
  };

  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
};
