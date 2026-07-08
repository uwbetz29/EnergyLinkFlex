import { describe, it, expect } from "vitest";
import { buildChangeLedger } from "../change-ledger";

type Comp = { name: string; dims: Record<string, string> };

function comps(map: Record<string, Comp>): Record<string, Comp> {
  return map;
}

describe("buildChangeLedger", () => {
  it("returns [] when there are no originals", () => {
    expect(buildChangeLedger({}, {})).toEqual([]);
  });

  it("returns [] when a dim is unchanged", () => {
    const originals = { c1: { Height: "10'-0\"" } };
    const c = comps({ c1: { name: "Stack", dims: { Height: "10'-0\"" } } });
    expect(buildChangeLedger(originals, c)).toEqual([]);
  });

  it("reports a changed dimension with old/new, delta inches, and % change", () => {
    const originals = { c1: { Height: "10'-0\"" } };
    const c = comps({ c1: { name: "Stack", dims: { Height: "12'-0\"" } } });
    const rows = buildChangeLedger(originals, c);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      componentId: "c1",
      componentName: "Stack",
      dimKey: "Height",
      direction: "vertical",
      oldValue: "10'-0\"",
      newValue: "12'-0\"",
    });
    expect(rows[0].deltaInches).toBe(24); // 12ft - 10ft = 2ft = 24in
    expect(rows[0].pctChange).toBeCloseTo(20, 5); // (144-120)/120 = 20%
  });

  it("classifies a Width dim as horizontal and reports a shrink as negative", () => {
    const originals = { c1: { Width: "8'-0\"" } };
    const c = comps({ c1: { name: "Duct", dims: { Width: "6'-0\"" } } });
    const rows = buildChangeLedger(originals, c);
    expect(rows[0].direction).toBe("horizontal");
    expect(rows[0].deltaInches).toBe(-24);
    expect(rows[0].pctChange).toBeCloseTo(-25, 5); // (72-96)/96
  });

  it("skips non-dimensional dims that don't parse to inches (X Position, Rotation)", () => {
    const originals = { c1: { "X Position": "100", Rotation: "0", Height: "10'-0\"" } };
    const c = comps({
      c1: { name: "Stack", dims: { "X Position": "200", Rotation: "90", Height: "11'-0\"" } },
    });
    const rows = buildChangeLedger(originals, c);
    // Only the Height change survives; X Position / Rotation aren't feet-inches.
    expect(rows).toHaveLength(1);
    expect(rows[0].dimKey).toBe("Height");
  });

  it("skips a component that no longer exists in components", () => {
    const originals = { gone: { Height: "10'-0\"" } };
    expect(buildChangeLedger(originals, {})).toEqual([]);
  });

  it("aggregates across components and sorts by descending absolute delta", () => {
    const originals = {
      a: { Height: "10'-0\"" }, // +12in
      b: { Width: "20'-0\"" }, // -48in
      c: { Height: "5'-0\"" }, // +6in
    };
    const c = comps({
      a: { name: "A", dims: { Height: "11'-0\"" } },
      b: { name: "B", dims: { Width: "16'-0\"" } },
      c: { name: "C", dims: { Height: "5'-6\"" } },
    });
    const rows = buildChangeLedger(originals, c);
    expect(rows.map((r) => r.componentId)).toEqual(["b", "a", "c"]);
    expect(rows.map((r) => Math.abs(r.deltaInches))).toEqual([48, 12, 6]);
  });
});
