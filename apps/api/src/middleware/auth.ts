import type { RequestHandler } from "express";
import { getAuth } from "@clerk/express";

/**
 * Requires a valid Clerk session JWT (e.g. `Authorization: Bearer <token>`).
 * Must run after `clerkMiddleware()` in the Express chain.
 *
 * Sets `req.authContext` with the Clerk user id. Responds with 401 when
 * the token is missing or invalid.
 */
export const requireAuthContext: RequestHandler = (req, res, next) => {
  const { userId } = getAuth(req);

  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  req.authContext = { userId };
  next();
};
