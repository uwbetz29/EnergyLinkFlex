import { describe, it, expect } from "vitest";
import { buildDimensionsTable } from "../dimensions-table";

type Comp = { name: string; type: string; dims: Record<string, string> };
const comps = (m: Record<string, Comp>) => m;

describe("buildDimensionsTable", () => {
  it("returns [] with no components", () => {
    expect(buildDimensionsTable({})).toEqual([]);
  });

  it("extracts Height (vertical) and Width (horizontal) per component", () => {
    const rows = buildDimensionsTable(
      comps({
        c1: {
          name: "Stack",
          type: "equipment",
          dims: { Height: "50'-0\"", Width: "15'-0\"", "X Position": "100" },
        },
      })
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      componentId: "c1",
      name: "Stack",
      type: "equipment",
      height: "50'-0\"",
      width: "15'-0\"",
    });
  });

  it("leaves a missing axis null (component dimensioned on one axis only)", () => {
    const rows = buildDimensionsTable(
      comps({ c1: { name: "Duct", type: "duct", dims: { Width: "8'-0\"" } } })
    );
    expect(rows[0]).toMatchObject({ height: null, width: "8'-0\"" });
  });

  it("skips components with no directional dimension at all", () => {
    const rows = buildDimensionsTable(
      comps({
        c1: { name: "Marker", type: "annotation", dims: { "X Position": "5", Rotation: "0" } },
      })
    );
    expect(rows).toEqual([]);
  });

  it("sorts rows by component name", () => {
    const rows = buildDimensionsTable(
      comps({
        z: { name: "Zeta", type: "t", dims: { Height: "1'-0\"" } },
        a: { name: "Alpha", type: "t", dims: { Height: "2'-0\"" } },
        m: { name: "Mu", type: "t", dims: { Width: "3'-0\"" } },
      })
    );
    expect(rows.map((r) => r.name)).toEqual(["Alpha", "Mu", "Zeta"]);
  });
});
