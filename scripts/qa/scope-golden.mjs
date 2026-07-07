/**
 * Golden verification for the UNIFIED 2D SCOPING engine (U1 computeComponentBand → U2
 * crossBand), run OFFLINE against the real customer drawing (NOT committed — lives in
 * ~/dev/elf-lab). This is the live-gap closer for session 5: it proves on the actual
 * 75k-element Titan GA sheet that a WIDTH edit on a component with both a width AND a
 * height dim scopes its scaling to the component's cross-axis (Y) band — so vertically
 * STACKED neighbours in the same X-range are HELD RIGID (circles stay round, no oval),
 * while the target itself still widens. This is "deep #3" on real geometry.
 *
 * Target = GAS PATH (the only clean AI-labelled both-axes component on Sheet_2):
 *   Width  *D29 (14'-2")  → stretch axis X
 *   Height *D48 (Ø5'-11 7/8") → cross axis Y (the band that scopes the scaling)
 *
 * The proof is a CONTRAST on the SAME component + SAME +2' edit: the ONLY variable is
 * crossBand. Without it (old full-height X-band behaviour) the stacked neighbours oval;
 * with it (U1→U2) they are held. computeComponentBand is driven from a real dimBlocks
 * map exactly as svg-drawing-canvas.tsx applyAllStretches does, so U1 and U2 are both
 * exercised end-to-end on geometry they never saw.
 *
 * Run from ~/dev/elf-lab (which has linkedom + the SVG):
 *   node --import ./register.mjs /Users/mike/dev/EnergyLinkFlex/scripts/qa/scope-golden.mjs
 */
import { readFileSync } from "node:fs";

const LAB = process.env.ELF_LAB || "/Users/mike/dev/elf-lab";
const { DOMParser } = await import(`${LAB}/node_modules/linkedom/esm/index.js`);

const APP = "/Users/mike/dev/EnergyLinkFlex/src/lib/dwg";
const { applyMultiStretch, findModelSpace, fastPosition, saveOriginalViewBox, undoStretches } =
  await import(`${APP}/svg-stretch.ts`);
const { computeComponentBand } = await import(`${APP}/dim-geometry.ts`);
const { isAnnotationElement } = await import(`${APP}/annotations.ts`);
const { AXIS_TOL } = await import(`${APP}/axis-map.ts`);

const SVG_PATH = `${LAB}/24081-CS1-0001_Sheet_2.svg`;
const raw = readFileSync(SVG_PATH, "utf8");
const load = () => new DOMParser().parseFromString(raw, "image/svg+xml").documentElement;

let pass = true;
const check = (cond, msg) => { if (!cond) { pass = false; console.log("  FAIL:", msg); } else console.log("  ok:", msg); };
const near = (a, b, tol = 1e-3) => Math.abs(a - b) < tol;
const sxOf = (el) => { const m = (el.getAttribute("transform") || "").match(/scale\(\s*([-\d.eE]+)/); return m ? +m[1] : 1; };
const syOf = (el) => { const m = (el.getAttribute("transform") || "").match(/scale\(\s*[-\d.eE]+\s*,\s*([-\d.eE]+)\s*\)/); return m ? +m[1] : 1; };

// GAS PATH real dim blocks. Keys map to a direction via dimKeyToDirection ("width" →
// horizontal, "height" → vertical), so this is the exact shape the store hands the app.
const GAS_PATH = { Width: "*D29", Height: "*D48" };
const DELTA = 24; // +2'-0" — a realistic sales width edit
const STACK = { yLo: 291.5, yHi: 891.5 }; // full near-elevation stack extent (4000 STACK *D28)

// ── U1: computeComponentBand yields a REAL scoped cross-band, not the full height ──
const band = computeComponentBand(GAS_PATH, load(), "x");
check(band != null, "computeComponentBand(GAS PATH, x) returns a band");
const [xLo, xHi] = band.aRange;
const [yLo, yHi] = band.crossBand;
console.log(`  band: aRange(X)=[${xLo.toFixed(1)}, ${xHi.toFixed(1)}]  crossBand(Y)=[${yLo.toFixed(1)}, ${yHi.toFixed(1)}]`);
check(isFinite(xLo) && isFinite(xHi) && xHi - xLo > 1, `aRange is a real X interval (w=${(xHi - xLo).toFixed(1)})`);
check(isFinite(yLo) && isFinite(yHi) && yHi - yLo > 1, `crossBand is a real Y interval (h=${(yHi - yLo).toFixed(1)})`);
// The scoped band must be a STRICT subset of the full stack — otherwise it wouldn't
// hold anything (that is the whole point of deep #3).
check(yLo > STACK.yLo + 1 && yHi < STACK.yHi - 1,
  `crossBand is strictly inside the full stack Y[${STACK.yLo},${STACK.yHi}] (scoped, not full-height)`);

// Classifiers in the app's Model_Space Y-up frame (fastPosition == crossBand frame).
const inXZone = (p) => p.x >= xLo && p.x <= xHi;
const inBandY = (p) => p.y >= yLo && p.y <= yHi;
// "clearly out of band" excludes the ±AXIS_TOL boundary so the assertion is crisp.
const MARGIN = AXIS_TOL * 2;
const clearlyOut = (p) => p.y > yHi + MARGIN || p.y < yLo - MARGIN;
const expectSx = (xHi - xLo + DELTA) / (xHi - xLo);
console.log(`  expected in-band scaleX = ${expectSx.toFixed(4)} (widen ${DELTA} over ${(xHi - xLo).toFixed(1)})`);

const vbOf = (svg) => svg.getAttribute("viewBox").split(/\s+/).map(Number);
const widthSpec = (svg, crossBand) => {
  const vb = vbOf(svg);
  return {
    componentId: "gasPath",
    direction: "horizontal",
    delta: DELTA,
    svgBounds: { top: vb[1], bottom: vb[1] + vb[3], left: xLo, right: xHi },
    crossBand, // undefined = old full-band behaviour; {lo,hi} = U2 scoping
  };
};

// Tally scaling of equipment in Gas Path's X-zone, split by band membership.
const tally = (svg) => {
  let inBandScaled = 0, inBandTotal = 0, outClearScaled = 0, outClearTotal = 0, anySy = 0;
  for (const k of Array.from(findModelSpace(svg).children)) {
    const p = fastPosition(k);
    if (!p || !inXZone(p) || isAnnotationElement(k)) continue;
    if (!near(syOf(k), 1)) anySy++; // a width edit must never scale anything on Y
    if (inBandY(p)) { inBandTotal++; if (near(sxOf(k), expectSx)) inBandScaled++; }
    else if (clearlyOut(p)) { outClearTotal++; if (!near(sxOf(k), 1)) outClearScaled++; }
  }
  return { inBandScaled, inBandTotal, outClearScaled, outClearTotal, anySy };
};

// ── NEW (U2): crossBand scopes the scale — target widens, stacked neighbours HELD ──
let outClearTotalNew;
{
  const svg = load();
  const res = applyMultiStretch(svg, [widthSpec(svg, { lo: yLo, hi: yHi })]);
  check(res.ok === true, `crossBand width stretch returns ok:true (transformed=${res.transformed})`);
  const t = tally(svg);
  outClearTotalNew = t.outClearTotal;
  console.log(`  NEW: in-band scaled ${t.inBandScaled}/${t.inBandTotal}, clearly-out scaled ${t.outClearScaled}/${t.outClearTotal}`);
  check(t.inBandTotal > 0 && t.inBandScaled === t.inBandTotal,
    `target (in-band) equipment ALL widen at scaleX ${expectSx.toFixed(3)} (${t.inBandScaled}/${t.inBandTotal})`);
  check(t.outClearTotal > 0, `there ARE stacked out-of-band neighbours to hold (n=${t.outClearTotal})`);
  check(t.outClearScaled === 0,
    `every clearly-out-of-band neighbour is HELD RIGID (round, not ovaled) — scaled=${t.outClearScaled}`);
  check(t.anySy === 0, `no element is scaled on Y by a width edit (got ${t.anySy})`);

  // viewBox grew by exactly the width delta; nothing on the height axis moved.
  const vb0 = vbOf(load()), vb1 = vbOf(svg);
  check(near(vb1[2] - vb0[2], DELTA), `viewBox width grew by ${DELTA} (${vb0[2].toFixed(1)} → ${vb1[2].toFixed(1)})`);
  check(near(vb1[3] - vb0[3], 0), `viewBox height unchanged by a width edit`);
}

// ── OLD (no crossBand): the SAME edit ovals the SAME neighbours — proves crossBand is
//    the fix, and that the NEW assertion above isn't vacuous (there was real distortion) ──
{
  const svg = load();
  const res = applyMultiStretch(svg, [widthSpec(svg, undefined)]);
  check(res.ok === true, `no-crossBand width stretch returns ok:true (transformed=${res.transformed})`);
  const t = tally(svg);
  console.log(`  OLD: clearly-out scaled ${t.outClearScaled}/${t.outClearTotal} (these would oval)`);
  check(t.outClearTotal === outClearTotalNew, `same out-of-band population in both runs (${t.outClearTotal})`);
  // Old behaviour ovals the vast majority of stacked neighbours (deep #3). Assert a
  // strong majority to stay robust to a handful of zero-width/degenerate elements.
  const ovaledFrac = t.outClearScaled / t.outClearTotal;
  check(ovaledFrac > 0.95,
    `OLD full-band behaviour OVALS the stacked neighbours (${t.outClearScaled}/${t.outClearTotal} = ${(ovaledFrac * 100).toFixed(1)}%)`);
}

// ── Undo restores geometry + viewBox with zero leftover markers ──
{
  const svg = load();
  const vb0 = svg.getAttribute("viewBox");
  saveOriginalViewBox(svg);
  applyMultiStretch(svg, [widthSpec(svg, { lo: yLo, hi: yHi })]);
  undoStretches(svg);
  const markers = findModelSpace(svg).querySelectorAll("[data-stretch-transform]").length;
  check(markers === 0, `undo left zero stretch markers (got ${markers})`);
  check(svg.getAttribute("viewBox") === vb0, `undo restored the original viewBox`);
}

console.log(pass ? "\nALL SCOPE GOLDEN ASSERTIONS PASS" : "\nSOME SCOPE GOLDEN ASSERTIONS FAILED");
process.exit(pass ? 0 : 1);
