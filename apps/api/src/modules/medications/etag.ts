/** HTTP ETag for medications from DB `version` only (opaque token `"v{n}"`). */

export function toEtag(version: number): string {
  return `"v${version}"`;
}

/**
 * Parse If-Match: first comma-separated candidate; supports `"v5"`, `v5`, `W/"v5"`.
 * Invalid or missing semantic version portion → null.
 */
export function parseIfMatch(header: string | undefined): number | null {
  if (header === undefined || header === null) {
    return null;
  }
  const trimmed = header.trim();
  if (trimmed === "") {
    return null;
  }

  let first = trimmed.split(",")[0]!.trim();
  if (first.toLowerCase().startsWith("w/")) {
    first = first.slice(2).trim();
  }
  if (first.startsWith('"') && first.endsWith('"') && first.length >= 2) {
    first = first.slice(1, -1).trim();
  }

  const m = /^v(\d+)$/i.exec(first);
  if (!m) {
    return null;
  }

  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 1) {
    return null;
  }

  return n;
}
