/**
 * STRETCH MATRIX — offline regression harness that exercises EVERY labelled
 * component × EVERY dimension on the real Titan GA sheet and measures whether a
 * stretch damages geometry OUTSIDE the edited component's own footprint
 * ("collateral"). A correct edit transforms only the component's own column/band;
 * collateral = the open-gap bug (e.g. raising a mid-flow duct's height lifting the
 * whole upper drawing).
 *
 * This is the test that was MISSING: prior goldens only covered Gas Path (width)
 * and a couple of nested-zone cases, so mid-flow height edits (Dist. Grid Duct)
 * were never exercised.
 *
 * Real customer geometry is NOT committed — the SVG + AI sections live in the lab.
 * Run:
 *   node --import /Users/mike/dev/elf-lab/register.mjs \
 *        /Users/mike/dev/EnergyLinkFlex/scripts/qa/stretch-matrix.mjs
 */
import { readFileSync } from "node:fs";

const LAB = process.env.ELF_LAB || "/Users/mike/dev/elf-lab";
const { DOMParser } = await import(`${LAB}/node_modules/linkedom/esm/index.js`);
const APP = "/Users/mike/dev/EnergyLinkFlex/src/lib/dwg";

const {
  applyMultiStretch, findModelSpace, fastPosition, dimKeyToDirection,
} = await import(`${APP}/svg-stretch.ts`);
const { getDimBlockBounds, computeComponentBand } = await import(`${APP}/dim-geometry.ts`);
const { computeViewRegions, viewOf } = await import(`${APP}/view-model.ts`);
const { AXIS_TOL } = await import(`${APP}/axis-map.ts`);
const { isAnnotationElement } = await import(`${APP}/annotations.ts`);

const SVG_PATH = `${LAB}/24081-CS1-0001_Sheet_2.svg`;
const raw = readFileSync(SVG_PATH, "utf8");
const load = () => new DOMParser().parseFromString(raw, "image/svg+xml").documentElement;

// The 9 AI-labelled components for project 215a08eb (pulled from dwg_ai_sections),
// each with its REAL dims + dim block ids — exactly what the app hands the engine.
const COMPONENTS = [
  { name: "Gas Path",       dims: { Width: "14'-2\"", Height: "Ø5'-11 7/8\"" }, dimBlocks: { Width: "*D29", Height: "*D48" } },
  { name: "D.I. Duct",      dims: { Width: "9'-0\"", Height: "21'-3\"" },        dimBlocks: { Width: "*D20", Height: "*D51" } },
  { name: "T.A. Duct",      dims: { Width: "9'-8 3/4\"", Height: "18'-1 1/16\"" }, dimBlocks: { Width: "*D21", Height: "*D31" } },
  { name: "Dist. Grid Duct", dims: { Width: "11'-0 1/8\"", Height: "14'-1 7/16\"" }, dimBlocks: { Width: "*D19", Height: "*D32" } },
  { name: "SCR Duct",       dims: { Width: "10'-2 5/8\"", Width2: "10'-2 5/8\"" }, dimBlocks: { Width: "*D24", Width2: "*D15" } },
  { name: "Silencer",       dims: { Height: "8'-0\"" },                          dimBlocks: { Height: "*D41" } },
  { name: "Inside Liner",   dims: { Width: "Ø9'-0\"" },                          dimBlocks: { Width: "*D40" } },
  { name: "4000 Stack",     dims: { Width: "15'-0 1/8\"", Height: "50'-0\"" },   dimBlocks: { Width: "*D43", Height: "*D28" } },
  { name: "Grating",        dims: { Width: "6'-5 3/4\"" },                       dimBlocks: { Width: "*D52" } },
];

const EDIT_FT = 3; // realistic sales edit: +3'-0" on each dim

const ty = (el) => { const m = (el.getAttribute("transform")||"").match(/translate\(\s*[-\d.eE]+\s*,\s*([-\d.eE]+)/); return m ? +m[1] : 0; };
const tx = (el) => { const m = (el.getAttribute("transform")||"").match(/translate\(\s*([-\d.eE]+)/); return m ? +m[1] : 0; };

function runOne(comp, dimKey) {
  const svg = load();
  const dir = dimKeyToDirection(dimKey);
  if (!dir) return { skip: `no direction for ${dimKey}` };
  const blockId = comp.dimBlocks[dimKey];
  const dimBounds = getDimBlockBounds(svg, blockId, dir);
  if (!dimBounds) return { skip: `no dim block bounds for ${blockId}` };

  const sectionSize = dimBounds.max - dimBounds.min;
  // delta in Model_Space units for a +EDIT_FT edit (mirrors computeStretchDelta ratio)
  const oldIn = parseFeet(comp.dims[dimKey]);
  const delta = sectionSize * ((oldIn + EDIT_FT * 12) / oldIn - 1);

  const vb = svg.getAttribute("viewBox").split(/\s+/).map(Number);
  const svgBounds = dir === "vertical"
    ? { top: -dimBounds.max, bottom: -dimBounds.min, left: vb[0], right: vb[0] + vb[2] }
    : { top: vb[1], bottom: vb[1] + vb[3], left: dimBounds.min, right: dimBounds.max };

  const modelSpace = findModelSpace(svg);
  const viewRegions = computeViewRegions(modelSpace);
  let viewRegion;
  if (dir === "horizontal" && viewRegions.length > 1) {
    viewRegion = viewOf((dimBounds.min + dimBounds.max) / 2, viewRegions) ?? undefined;
  }
  const crossDir = dir === "horizontal" ? "vertical" : "horizontal";
  const hasCrossDim = Object.keys(comp.dimBlocks).some((k) => dimKeyToDirection(k) === crossDir);
  const band = hasCrossDim ? computeComponentBand(comp.dimBlocks, svg, dir === "horizontal" ? "x" : "y") : null;
  const crossBand = band ? { lo: band.crossBand[0], hi: band.crossBand[1] } : undefined;

  // GUARD (mirrors svg-drawing-canvas): a height edit with no column (no cross dim)
  // is refused rather than allowed to lift the whole drawing.
  if (dir === "vertical" && !crossBand) return { guarded: true };

  const params = { componentId: comp.name, svgBounds, direction: dir, delta, viewRegion, crossBand };
  const res = applyMultiStretch(svg, [params]);
  if (!res.ok) return { ok: false, reason: res.reason };

  // Collateral: transformed elements whose CROSS-position is outside the edited
  // component's own band (for a height edit, cross = X). These are neighbours /
  // other views that a height edit should NOT have moved. Measure count + the max
  // rigid shift applied to them (the visible tear).
  const children = Array.from(modelSpace.children);
  let transformed = 0, collateral = 0, maxCollShift = 0;
  let cxMin = Infinity, cxMax = -Infinity;      // spatial spread of collateral
  const compLo = crossBand ? crossBand.lo : (dir === "vertical" ? dimBounds.min : null);
  const compHi = crossBand ? crossBand.hi : (dir === "vertical" ? dimBounds.max : null);
  for (const el of children) {
    if (el.getAttribute("data-stretch-transform") !== "true") continue;
    transformed++;
    // Annotations (dim graphics) ride their section's near-edge offset BY DESIGN —
    // that's the dim moving with its number, not an equipment gap. Only equipment
    // moving outside its column is the bug.
    if (isAnnotationElement(el)) continue;
    const pos = fastPosition(el);
    if (!pos) continue;
    const cross = dir === "vertical" ? pos.x : pos.y;
    const shift = dir === "vertical" ? ty(el) : tx(el);
    // For a HEIGHT edit, equipment outside the component's column must not move at all.
    // For a WIDTH edit, downstream (right-of-zone) shift is CORRECT flow propagation, so
    // only UPSTREAM (left-of-zone) leakage counts as collateral.
    const outOfBand = compLo == null ? false : (cross < compLo - AXIS_TOL || cross > compHi + AXIS_TOL);
    const upstreamLeak = dir === "horizontal" && pos.x < svgBounds.left - AXIS_TOL && Math.abs(shift) > 1;
    const isColl = dir === "vertical" ? (outOfBand && Math.abs(shift) > 1) : upstreamLeak;
    if (isColl) {
      collateral++;
      maxCollShift = Math.max(maxCollShift, Math.abs(shift));
      cxMin = Math.min(cxMin, cross); cxMax = Math.max(cxMax, cross);
    }
  }
  return {
    ok: true, dir, transformed, collateral, maxCollShift: Math.round(maxCollShift),
    delta: Math.round(delta), band: crossBand ? [Math.round(crossBand.lo), Math.round(crossBand.hi)] : null,
    collSpread: collateral ? [Math.round(cxMin), Math.round(cxMax)] : null,
  };
}

function parseFeet(s) {
  const clean = s.replace(/^[~Ø]/, "").trim().replace(/["″]$/, "");
  const m = clean.match(/(\d+)['‘′][- ]?(\d+)?(?:\s+(\d+)\/(\d+))?/);
  if (m) return (+m[1]) * 12 + (+(m[2]||0)) + (m[3] ? (+m[3])/(+m[4]) : 0);
  const n = parseFloat(clean); return isNaN(n) ? 1 : n;
}

console.log(`\nSTRETCH MATRIX — +${EDIT_FT}' on every component × dim (collateral = geometry moved OUTSIDE the edited band)\n`);
console.log("component          dim     dir         xf   collat  maxShift  band            collSpread");
console.log("─".repeat(96));
const COLLATERAL_MAX = 5; // allow a tiny boundary-noise tolerance; the bug was thousands
let broken = 0;
for (const comp of COMPONENTS) {
  for (const dimKey of Object.keys(comp.dimBlocks)) {
    const r = runOne(comp, dimKey);
    if (r.skip) { console.log(`${comp.name.padEnd(18)} ${dimKey.padEnd(7)} SKIP: ${r.skip}`); continue; }
    if (r.guarded) { console.log(`${comp.name.padEnd(18)} ${dimKey.padEnd(7)} GUARDED (refused — no column, safe no-op)`); continue; }
    if (!r.ok) { console.log(`${comp.name.padEnd(18)} ${dimKey.padEnd(7)} ROLLED BACK: ${r.reason}`); continue; }
    const bad = r.collateral > COLLATERAL_MAX;
    if (bad) broken++;
    console.log(
      `${comp.name.padEnd(18)} ${dimKey.padEnd(7)} ${r.dir.padEnd(10)} ${String(r.transformed).padStart(5)} ` +
      `${String(r.collateral).padStart(6)} ${String(r.maxCollShift).padStart(8)}  ${String(r.band||"full").padEnd(14)} ${String(r.collSpread||"-").padEnd(14)}${bad ? "  ⚠ BREAKS" : "  ok"}`
    );
  }
}
console.log("─".repeat(96));
console.log(
  broken === 0
    ? `\n✅ PASS — 0 component×dim combinations tear geometry (collateral ≤ ${COLLATERAL_MAX} equipment elements each).\n`
    : `\n❌ FAIL — ${broken} combination(s) still move equipment outside the edited column.\n`
);
process.exit(broken === 0 ? 0 : 1);
