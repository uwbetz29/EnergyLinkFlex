import type { ComponentDef } from "@/stores/editor-store";

/**
 * Hard-coded component definitions for the TITAN PGM 130 GA drawing.
 * These will eventually be replaced by AI detection from DXF parsing.
 * Bounding boxes are % of PDF page [left, top, width, height].
 */
export const TITAN_PGM130_COMPONENTS: Record<string, ComponentDef> = {
  stack: {
    id: "stack",
    name: "Upper Stack",
    type: "Exhaust Stack — ASTM A36 Carbon Steel",
    color: "#ef4444",
    icon: "▲",
    box: [3.5, 5, 9, 53],
    dims: { height: "15'-0 1/8\"", diameter: "9'-0\" (inside liner)" },
    dimBlocks: {},
    mainDim: "height",
    constraints: [
      { label: "EPA stack height", value: "> 35 ft AGL", ok: true },
      { label: "Wind load (10 mph)", value: "OK", ok: true },
    ],
    downstream: [],
    upstream: ["silencer"],
    notes:
      'AES fiber insulation (4" thick, 8 PCF). SS liner sheets (409 SS, 14 GA). Four (4) 4" CEMS ports. Four (4) 6" EPA ports.',
  },
  silencer: {
    id: "silencer",
    name: "Silencer",
    type: "Acoustic Attenuator — ASTM A36 Carbon Steel",
    color: "#ec4899",
    icon: "♫",
    box: [8.5, 28, 10, 25],
    dims: { height: "9'-8 3/4\"", width: "~16'-0\"" },
    dimBlocks: {},
    mainDim: "height",
    constraints: [
      { label: "Acoustic target", value: '< 85 dBA @ 3ft', ok: true },
      { label: "Pressure drop", value: '< 1.0" W.C.', ok: true },
    ],
    downstream: ["stack"],
    upstream: ["scr-module"],
    notes:
      'AES fiber insulation (4" thick, 8 PCF). SS liner sheets (409 SS, 14 GA). Liner sheets overlap in direction of rain fall.',
  },
  "scr-module": {
    id: "scr-module",
    name: "SCR Catalyst Module",
    type: "SCR Catalyst Housing — ASTM A36/A240",
    color: "#16a34a",
    icon: "◆",
    box: [16, 28, 28, 40],
    dims: { height: "~25'-0\"", width: "~9'-8 3/4\" + 4'-0 3/8\"" },
    dimBlocks: {},
    mainDim: "height",
    constraints: [
      { label: "SCR efficiency", value: "9.0–2.0 ppmvd @ 15% O2", ok: true },
      { label: "Catalyst clearance", value: '12" min', ok: true },
      { label: "NH3 grid spacing", value: "OK", ok: true },
    ],
    downstream: ["silencer", "stack"],
    upstream: ["dist-grid"],
    notes:
      "Full frame belt w/ integrated liner. High temp material w/ wire-reinforced backing & pillow flange. Inlet 304 SS, outlet A240 409 SS.",
  },
  "dist-grid": {
    id: "dist-grid",
    name: "Distribution Grid",
    type: "Flow Distribution — SS 304",
    color: "#8b5cf6",
    icon: "≡",
    box: [38, 30, 8, 33],
    dims: { height: "~11'-0 1/8\"", width: "matching module" },
    dimBlocks: {},
    mainDim: "height",
    constraints: [
      { label: "Flow uniformity", value: "< 15% CV", ok: true },
    ],
    downstream: ["scr-module", "silencer", "stack"],
    upstream: ["transition-duct"],
    notes:
      'Ensures uniform flow distribution across catalyst bed face. Referenced as "DIST. GRID" on drawing.',
  },
  "transition-duct": {
    id: "transition-duct",
    name: "Transition / Reactor Duct",
    type: "Connecting Ductwork — ASTM A36",
    color: "#f59e0b",
    icon: "═",
    box: [44, 38, 16, 28],
    dims: { length: "~10'-2 3/4\"", height: "~5'-11 7/8\"" },
    dimBlocks: {},
    mainDim: "length",
    constraints: [
      { label: "Mixing length", value: "> 3x hydraulic dia", ok: true },
      { label: "Pressure drop", value: '< 0.5" W.C.', ok: true },
    ],
    downstream: ["dist-grid", "scr-module", "silencer", "stack"],
    upstream: ["turbine-outlet"],
    notes:
      'ASTM A36 carbon steel casing. AES fiber insulation (4" thick, 8 PCF). SS liner sheets (409 SS, 12 GA floor, 14 GA walls/roof/stack).',
  },
  "inlet-exp": {
    id: "inlet-exp",
    name: "Inlet Expansion Joint",
    type: "Hot-to-Cold Expansion Joint (N12)",
    color: "#06b6d4",
    icon: "↔",
    box: [42, 48, 5, 15],
    dims: { gap: "4'-0 1/8\"" },
    dimBlocks: {},
    mainDim: "gap",
    constraints: [
      { label: "Thermal growth", value: "Accommodated", ok: true },
    ],
    downstream: ["transition-duct"],
    upstream: ["turbine-outlet"],
    notes: "Hot-to-cold expansion. Referenced as N12 on nozzle schedule.",
  },
  "turbine-outlet": {
    id: "turbine-outlet",
    name: "Turbine Outlet Connection",
    type: "Gas Turbine Exhaust Interface",
    color: "#0ea5e9",
    icon: "☀",
    box: [58, 32, 16, 33],
    dims: { height: "14'-1 7/16\"", width: "6'-3 1/2\"" },
    dimBlocks: {},
    mainDim: "height",
    constraints: [
      { label: "Exhaust temp (T130)", value: "941°F normal", ok: true },
      { label: "Flow rate", value: "465.2 kPPH", ok: true },
    ],
    downstream: ["inlet-exp", "transition-duct"],
    upstream: [],
    notes:
      "Gas turbine exhaust outlet. Mass flow: 465.2 kPPH @ 600°F. Normal avg exhaust temp: 941°F.",
  },
};
