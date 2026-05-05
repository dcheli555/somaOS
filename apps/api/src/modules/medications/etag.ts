/** ETag for medications: millisecond `updated_at` (stable for optimistic concurrency). */

export function formatMedicationEtag(updatedAt: Date): string {
  return `"${updatedAt.getTime()}"`;
}

function normalizeEntityTag(part: string): string {
  let t = part.trim();
  if (t.toLowerCase().startsWith("w/")) {
    t = t.slice(2).trim();
  }
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
    t = t.slice(1, -1);
  }
  return t;
}

/** Returns true if `ifMatchHeader` matches `updatedAt` (supports comma-separated list, `*`). */
export function medicationEtagMatches(
  ifMatchHeader: string,
  updatedAt: Date,
): boolean {
  const expected = String(updatedAt.getTime());
  for (const raw of ifMatchHeader.split(",")) {
    const n = normalizeEntityTag(raw);
    if (n === "*" || n === expected) {
      return true;
    }
  }
  return false;
}

export function assertIfMatchIfPresent(
  ifMatchHeader: string | undefined,
  updatedAt: Date,
): void {
  if (ifMatchHeader === undefined || ifMatchHeader.trim() === "") {
    return;
  }
  if (!medicationEtagMatches(ifMatchHeader, updatedAt)) {
    const err = new Error("IF_MATCH_FAILED") as Error & { code: string };
    err.code = "IF_MATCH_FAILED";
    throw err;
  }
}
