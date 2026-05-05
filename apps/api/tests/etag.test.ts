import { describe, expect, it } from "vitest";
import { parseIfMatch, toEtag } from "../src/modules/medications/etag";

describe("medication etag helpers", () => {
  it("toEtag(version)", () => {
    expect(toEtag(1)).toBe('"v1"');
    expect(toEtag(42)).toBe('"v42"');
  });

  it('parseIfMatch parses quoted "vN"', () => {
    expect(parseIfMatch('"v5"')).toBe(5);
    expect(parseIfMatch("v12")).toBe(12);
    expect(parseIfMatch('W/"v3"')).toBe(3);
  });

  it("parseIfMatch returns null for invalid input", () => {
    expect(parseIfMatch(undefined)).toBe(null);
    expect(parseIfMatch("")).toBe(null);
    expect(parseIfMatch('"x5"')).toBe(null);
    expect(parseIfMatch('"v0"')).toBe(null);
    expect(parseIfMatch('"v1","v2"')).toBe(1);
  });
});
