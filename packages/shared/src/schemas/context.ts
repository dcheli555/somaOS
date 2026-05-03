import { z } from "zod";

/** Authenticated user / principal attached to a request or job. */
export const userContextSchema = z.object({
  userId: z.string().min(1),
  email: z.string().email().optional(),
  roles: z.array(z.string()).default([]),
});

export type UserContext = z.infer<typeof userContextSchema>;

/** Per-request metadata and optional user binding. */
export const requestContextSchema = z.object({
  requestId: z.string().min(1),
  traceId: z.string().optional(),
  user: userContextSchema.optional(),
});

export type RequestContext = z.infer<typeof requestContextSchema>;
