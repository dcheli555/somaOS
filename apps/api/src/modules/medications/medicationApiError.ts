import type { Response } from "express";

/** Structured medication API errors (RFC 9457-aligned shape, minimal). */
export function sendMedicationApiError(
  res: Response,
  status: number,
  code: string,
  message: string,
  requestId: string,
): void {
  res.status(status).json({
    error: {
      code,
      message,
      requestId,
    },
  });
}
