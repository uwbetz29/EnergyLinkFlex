import { describe, it, expect } from "vitest";
import { validateDimValue, parseDimInches } from "../svg-stretch";

describe("parseDimInches defensive input", () => {
  it("returns null for undefined/null (cascade & change-info paths pass these)", () => {
    expect(parseDimInches(undefined as unknown as string)).toBeNull();
    expect(parseDimInches(null as unknown as string)).toBeNull();
  });
});

describe("validateDimValue", () => {
  it("accepts a normal engineering dimension and returns its inches", () => {
    const r = validateDimValue("12'-0\"");
    expect(r.ok).toBe(true);
    expect(r.inches).toBe(144);
  });

  it("accepts a fractional engineering dimension", () => {
    const r = validateDimValue("8'-6 1/2\"");
    expect(r.ok).toBe(true);
    expect(r.inches).toBe(102.5);
  });

  it("accepts a plain numeric (DWG scale unit) value", () => {
    const r = validateDimValue("24");
    expect(r.ok).toBe(true);
    expect(r.inches).toBe(24);
  });

  it("rejects zero (collapse source)", () => {
    const r = validateDimValue("0");
    expect(r.ok).toBe(false);
    expect(r.reason).toBeTruthy();
  });

  it("rejects a zero engineering dimension", () => {
    const r = validateDimValue("0'-0\"");
    expect(r.ok).toBe(false);
  });

  it("rejects a negative numeric value (mirror source)", () => {
    const r = validateDimValue("-5");
    expect(r.ok).toBe(false);
  });

  it("rejects an unparseable string", () => {
    const r = validateDimValue("abc");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/unparse/i);
  });

  it("rejects an empty string", () => {
    const r = validateDimValue("");
    expect(r.ok).toBe(false);
  });

  it("rejects a whitespace-only string", () => {
    const r = validateDimValue("   ");
    expect(r.ok).toBe(false);
  });

  it("rejects a non-finite value", () => {
    const r = validateDimValue("Infinity");
    expect(r.ok).toBe(false);
  });

  it("rejects an implausibly large dimension (garbage)", () => {
    const r = validateDimValue("999999'-0\"");
    expect(r.ok).toBe(false);
  });
});
