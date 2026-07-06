/**
 * Golden verification for the NESTED-ZONE stretch composition engine, run OFFLINE
 * against the real customer drawing (NOT committed — lives in ~/dev/elf-lab). Proves
 * the redistribute case on the actual 75k-element Titan GA sheet: the overall
 * "4000 STACK" zone (internal y[291.5, 891.5], the 50'-0") CONTAINS the silencer
 * (y[531.3, 627.3], the 8'-0"); growing the overall by +48 while HOLDING the silencer
 * must scale the two stack gaps (never the silencer) and ride everything above by +48.
 *
 * This harness is authored by the orchestrator, independent of the implementer, and
 * drives ONLY the public applyMultiStretch. Run from ~/dev/elf-lab:
 *   node --import ./register.mjs /Users/mike/dev/EnergyLinkFlex/scripts/qa/nested-zone-golden.mjs
 */
import { readFileSync } from "node:fs";

const LAB = process.env.ELF_LAB || "/Users/mike/dev/elf-lab";
const { DOMParser } = await import(`${LAB}/node_modules/linkedom/esm/index.js`);

const APP = "/Users/mike/dev/EnergyLinkFlex/src/lib/dwg";
const { applyMultiStretch, resolveContainerResiduals, undoStretches, saveOriginalViewBox, findModelSpace, fastPosition } = await import(`${APP}/svg-stretch.ts`);
const { isAnnotationElement } = await import(`${APP}/annotations.ts`);

const SVG_PATH = "/Users/mike/dev/elf-lab/24081-CS1-0001_Sheet_2.svg";
const raw = readFileSync(SVG_PATH, "utf8");
const load = () => new DOMParser().parseFromString(raw, "image/svg+xml").documentElement;

let pass = true;
const check = (cond, msg) => { if (!cond) { pass = false; console.log("  FAIL:", msg); } else console.log("  ok:", msg); };

// Real-drawing nesting (internal Y-up coords).
const CONTAINER = { top: -891.5, bottom: -291.5 };   // 50'-0" overall  [291.5, 891.5]
const SILENCER  = { top: -627.3, bottom: -531.3 };    // 8'-0" silencer   [531.3, 627.3]
const GAPS = 600 - 96;                                 // 504
const GAP_SCALE = (GAPS + 48) / GAPS;                  // 1.0952380952
const FULLW = { left: -1e6, right: 1e6 };

const syOf = (el) => {
  const m = (el.getAttribute("transform") || "").match(/scale\(\s*[-\d.eE]+\s*,\s*([-\d.eE]+)\s*\)/);
  return m ? +m[1] : 1;
};
const tyOf = (el) => {
  const m = (el.getAttribute("transform") || "").match(/translate\(\s*[-\d.eE]+\s*,\s*([-\d.eE]+)\s*\)/);
  return m ? +m[1] : 0;
};
const near = (a, b, tol = 1e-3) => Math.abs(a - b) < tol;

// ── Redistribute: overall +48 with the silencer HELD (delta 0) ──
{
  const svg = load();
  const h0 = svg.getAttribute("viewBox").split(/\s+/).map(Number)[3];
  const res = applyMultiStretch(svg, [
    { componentId: "sil", direction: "vertical", delta: 0, svgBounds: { ...SILENCER, ...FULLW } },      // held child
    { componentId: "overall", direction: "vertical", delta: 48, svgBounds: { ...CONTAINER, ...FULLW } }, // container residual
  ]);
  check(res.ok === true, `nested redistribute returns ok:true (transformed=${res.transformed})`);

  const kids = Array.from(findModelSpace(svg).children);
  // Interior bands (kept off the segment joins to avoid midpoint straddlers).
  const band = (lo, hi) => kids.filter((k) => { const p = fastPosition(k); return p && !isAnnotationElement(k) && p.y > lo && p.y < hi; });
  const lowerGap = band(320, 500), silencer = band(550, 610), upperGap = band(660, 860);

  const gapOk = (els) => els.length > 0 && els.every((k) => near(syOf(k), GAP_SCALE));
  const heldOk = (els) => els.length > 0 && els.every((k) => near(syOf(k), 1));

  check(gapOk(lowerGap), `lower-gap equipment all scale ${GAP_SCALE.toFixed(4)} (n=${lowerGap.length}, mismatched=${lowerGap.filter((k) => !near(syOf(k), GAP_SCALE)).length})`);
  check(heldOk(silencer), `silencer equipment HELD at scale 1, not gap-scaled (n=${silencer.length}, mismatched=${silencer.filter((k) => !near(syOf(k), 1)).length})`);
  check(gapOk(upperGap), `upper-gap equipment all scale ${GAP_SCALE.toFixed(4)} (n=${upperGap.length}, mismatched=${upperGap.filter((k) => !near(syOf(k), GAP_SCALE)).length})`);
  // Above the overall zone top (891.5): nothing may be scaled, and anything
  // transformed must ride the rigid +48. The overall zone spans the full stack
  // height, so this region is sparse; the viewBox+48 check below is the primary
  // top-shift proof. This guards against an above-element distorting or mis-shifting.
  const aboveEls = kids.filter((k) => { const p = fastPosition(k); return p && p.y > 894.5; });
  const aboveScaled = aboveEls.filter((k) => !near(syOf(k), 1)).length;
  const aboveBadShift = aboveEls.filter((k) => (k.getAttribute("transform") || "") !== "" && !near(tyOf(k), 48)).length;
  check(aboveScaled === 0 && aboveBadShift === 0, `above-container elements ride rigid +48, none scaled (n=${aboveEls.length}, scaled=${aboveScaled}, badShift=${aboveBadShift})`);

  // No annotation is ever scaled (hold rule) under nesting.
  const annoScaled = kids.filter((k) => isAnnotationElement(k) && !near(syOf(k), 1)).length;
  check(annoScaled === 0, `no annotation scaled under nesting (got ${annoScaled})`);

  // viewBox top grew by exactly the true geometric top shift (+48).
  const h1 = svg.getAttribute("viewBox").split(/\s+/).map(Number)[3];
  check(near(h1 - h0, 48, 1e-3), `viewBox height grew by 48 (${h0.toFixed(2)} -> ${h1.toFixed(2)})`);
}

// ── Caller policy: a simultaneous total+component edit (FULL deltas) resolves to
//    residuals so the total grows by the edited amount, not the double-counted sum ──
{
  const svg = load();
  const h0 = svg.getAttribute("viewBox").split(/\s+/).map(Number)[3];
  // App passes each edited dim with its FULL delta: overall +48 AND silencer +24.
  const full = [
    { componentId: "sil", direction: "vertical", delta: 24, svgBounds: { ...SILENCER, ...FULLW } },
    { componentId: "overall", direction: "vertical", delta: 48, svgBounds: { ...CONTAINER, ...FULLW } },
  ];
  const resolved = resolveContainerResiduals(full);
  // overall's residual = 48 - 24 = 24; silencer unchanged.
  const overallDelta = resolved.find((s) => s.componentId === "overall").delta;
  check(near(overallDelta, 24, 1e-6), `container delta resolved to residual 24 (got ${overallDelta})`);
  const res = applyMultiStretch(svg, resolved);
  check(res.ok === true, `resolved nested edit returns ok:true`);
  const h1 = svg.getAttribute("viewBox").split(/\s+/).map(Number)[3];
  // total grows by 48 (the edited overall), NOT 72 (the double-counted 48+24).
  check(near(h1 - h0, 48, 1e-3), `total grew 48 not 72 — no double-count (${(h1 - h0).toFixed(2)})`);
  // silencer still scales 1.25 (its own +24 over 96).
  const kids = Array.from(findModelSpace(svg).children);
  const silEq = kids.filter((k) => { const p = fastPosition(k); return p && p.y > 550 && p.y < 610; });
  check(silEq.length > 0 && silEq.every((k) => near(syOf(k), (96 + 24) / 96)), `silencer scales 1.25 under resolved edit (n=${silEq.length})`);
}

// ── Undo restores geometry + viewBox with zero leftover markers ──
{
  const svg = load();
  const vb0 = svg.getAttribute("viewBox");
  saveOriginalViewBox(svg); // app calls this before stretching; undoStretches reads it back
  applyMultiStretch(svg, [
    { componentId: "sil", direction: "vertical", delta: 0, svgBounds: { ...SILENCER, ...FULLW } },
    { componentId: "overall", direction: "vertical", delta: 48, svgBounds: { ...CONTAINER, ...FULLW } },
  ]);
  undoStretches(svg);
  const markers = findModelSpace(svg).querySelectorAll("[data-stretch-transform]").length;
  check(markers === 0, `undo left zero stretch markers (got ${markers})`);
  check(svg.getAttribute("viewBox") === vb0, `undo restored the original viewBox`);
}

console.log(pass ? "\nALL NESTED GOLDEN ASSERTIONS PASS" : "\nSOME NESTED GOLDEN ASSERTIONS FAILED");
process.exit(pass ? 0 : 1);
