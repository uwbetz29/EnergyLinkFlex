import { describe, it, expect } from "vitest";
import { buildDeterministicSummary, type AppliedChange } from "../change-summary";

/**
 * RED harness for the post-cascade plain-language summary engine (WS2).
 *
 * Contract (Opus-authored; the builder is Fable-built and MUST match these exactly):
 *
 *   buildDeterministicSummary(primary: AppliedChange | null, cascades: AppliedChange[]): string | null
 *
 * - `primary` is the user's own dimension edit that triggered the cascade.
 * - `cascades` are the downstream changes the engine applied in response.
 * - Returns ONE salesperson-readable sentence, or null when there is nothing to say.
 *
 * Direction verb is chosen from the dim label + the numeric sign of (new - old),
 * parsed via parseDimInches:
 *   width  → Widened / Narrowed
 *   height → Raised / Lowered
 *   length → Lengthened / Shortened
 *   other  → Increased / Reduced
 *   equal or unparseable magnitude → Adjusted (no direction)
 *
 * Primary clause:  "{Verb} {component}'s {dimLabel} from {old} to {new}."
 * Cascade clause (appended, space-separated):
 *   0 cascades → "No downstream components required changes."
 *   ≥1 cascades → "This cascaded to {list}." where {list} is the cascades sorted
 *                 by componentName (ASCII), each rendered "{component} ({dimLabel} → {new})",
 *                 joined as: 1→"a"; 2→"a and b"; 3+→"a, b and c".
 * Edge: primary === null with cascades → "Cascade applied: {list}."
 * Edge: primary === null and no cascades → null.
 */

const AC = (
  componentName: string,
  dimLabel: string,
  oldValue: string,
  newValue: string
): AppliedChange => ({ componentName, dimLabel, oldValue, newValue });

describe("buildDeterministicSummary", () => {
  it("returns null when there is nothing to summarize", () => {
    expect(buildDeterministicSummary(null, [])).toBeNull();
  });

  it("width increase with no cascades → Widened", () => {
    expect(
      buildDeterministicSummary(AC("SCR Duct", "Width", "10'-0\"", "12'-0\""), [])
    ).toBe(
      "Widened SCR Duct's Width from 10'-0\" to 12'-0\". No downstream components required changes."
    );
  });

  it("width decrease → Narrowed", () => {
    expect(
      buildDeterministicSummary(AC("SCR Duct", "Width", "12'-0\"", "10'-0\""), [])
    ).toBe(
      "Narrowed SCR Duct's Width from 12'-0\" to 10'-0\". No downstream components required changes."
    );
  });

  it("height increase → Raised", () => {
    expect(
      buildDeterministicSummary(AC("4000 Stack", "Height", "50'-0\"", "52'-0\""), [])
    ).toBe(
      "Raised 4000 Stack's Height from 50'-0\" to 52'-0\". No downstream components required changes."
    );
  });

  it("length decrease → Shortened", () => {
    expect(
      buildDeterministicSummary(AC("Gas Path", "Length", "20'-0\"", "18'-0\""), [])
    ).toBe(
      "Shortened Gas Path's Length from 20'-0\" to 18'-0\". No downstream components required changes."
    );
  });

  it("unknown dim label uses the generic Increased/Reduced verb", () => {
    expect(
      buildDeterministicSummary(AC("Silencer", "Diameter", "8'-0\"", "9'-0\""), [])
    ).toBe(
      "Increased Silencer's Diameter from 8'-0\" to 9'-0\". No downstream components required changes."
    );
  });

  it("height decrease → Lowered", () => {
    expect(
      buildDeterministicSummary(AC("4000 Stack", "Height", "52'-0\"", "50'-0\""), [])
    ).toBe(
      "Lowered 4000 Stack's Height from 52'-0\" to 50'-0\". No downstream components required changes."
    );
  });

  it("length increase → Lengthened", () => {
    expect(
      buildDeterministicSummary(AC("Gas Path", "Length", "18'-0\"", "20'-0\""), [])
    ).toBe(
      "Lengthened Gas Path's Length from 18'-0\" to 20'-0\". No downstream components required changes."
    );
  });

  it("unknown dim decrease uses the generic Reduced verb", () => {
    expect(
      buildDeterministicSummary(AC("Silencer", "Diameter", "9'-0\"", "8'-0\""), [])
    ).toBe(
      "Reduced Silencer's Diameter from 9'-0\" to 8'-0\". No downstream components required changes."
    );
  });

  it("equal old/new magnitude → Adjusted (no direction word)", () => {
    expect(
      buildDeterministicSummary(AC("SCR Duct", "Width", "10'-0\"", "10'-0\""), [])
    ).toBe(
      "Adjusted SCR Duct's Width from 10'-0\" to 10'-0\". No downstream components required changes."
    );
  });

  it("unparseable magnitudes → Adjusted", () => {
    expect(
      buildDeterministicSummary(AC("Panel", "Note", "N/A", "TBD"), [])
    ).toBe(
      "Adjusted Panel's Note from N/A to TBD. No downstream components required changes."
    );
  });

  it("primary + one cascade", () => {
    expect(
      buildDeterministicSummary(AC("SCR Duct", "Width", "12'-0\"", "14'-6\""), [
        AC("4000 Stack", "Height", "50'-0\"", "52'-0\""),
      ])
    ).toBe(
      "Widened SCR Duct's Width from 12'-0\" to 14'-6\". This cascaded to 4000 Stack (Height → 52'-0\")."
    );
  });

  it("primary + two cascades, sorted by component name, joined with 'and'", () => {
    expect(
      buildDeterministicSummary(AC("SCR Duct", "Width", "12'-0\"", "14'-6\""), [
        AC("Stack", "Height", "50'-0\"", "52'-0\""),
        AC("Silencer", "Length", "8'-0\"", "9'-0\""),
      ])
    ).toBe(
      "Widened SCR Duct's Width from 12'-0\" to 14'-6\". This cascaded to Silencer (Length → 9'-0\") and Stack (Height → 52'-0\")."
    );
  });

  it("primary + three cascades → comma list with 'and' before the last", () => {
    expect(
      buildDeterministicSummary(AC("SCR Duct", "Width", "12'-0\"", "14'-6\""), [
        AC("T.A. Duct", "Width", "18'-0\"", "19'-0\""),
        AC("Stack", "Height", "50'-0\"", "52'-0\""),
        AC("Silencer", "Length", "8'-0\"", "9'-0\""),
      ])
    ).toBe(
      "Widened SCR Duct's Width from 12'-0\" to 14'-6\". This cascaded to Silencer (Length → 9'-0\"), Stack (Height → 52'-0\") and T.A. Duct (Width → 19'-0\")."
    );
  });

  it("cascades only (no primary) → 'Cascade applied' list", () => {
    expect(
      buildDeterministicSummary(null, [
        AC("Stack", "Height", "50'-0\"", "52'-0\""),
        AC("Silencer", "Length", "8'-0\"", "9'-0\""),
      ])
    ).toBe(
      "Cascade applied: Silencer (Length → 9'-0\") and Stack (Height → 52'-0\")."
    );
  });

  it("does not mutate its inputs", () => {
    const cascades = [
      AC("Stack", "Height", "50'-0\"", "52'-0\""),
      AC("Silencer", "Length", "8'-0\"", "9'-0\""),
    ];
    const snapshot = JSON.stringify(cascades);
    buildDeterministicSummary(AC("SCR Duct", "Width", "12'-0\"", "14'-6\""), cascades);
    expect(JSON.stringify(cascades)).toBe(snapshot);
  });
});
