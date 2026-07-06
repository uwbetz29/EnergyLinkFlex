/**
 * Golden verification for the per-view spatial-scoping feature, run OFFLINE against the
 * real customer drawing (NOT committed — lives in ~/dev/elf-lab). Proves the deterministic
 * view model + scoped/annotation-aware stretch + safety net behave correctly on the actual
 * 75k-element Titan GA sheet, which the synthetic unit-test fixtures cannot.
 *
 * Run from ~/dev/elf-lab (which has linkedom + the SVG):
 *   node --import ./register.mjs /path/to/EnergyLinkFlex/scripts/qa/spatial-scoping-golden.mjs
 * (register.mjs installs a resolve hook that appends `.ts` to the app's extensionless imports.)
 */
import { readFileSync } from "node:fs";

// This QA harness runs from the offline lab (which has linkedom + the customer SVG); the
// app repo intentionally does NOT depend on linkedom. Resolve it from the lab (override
// with ELF_LAB env var if the lab lives elsewhere).
const LAB = process.env.ELF_LAB || "/Users/mike/dev/elf-lab";
const { DOMParser } = await import(`${LAB}/node_modules/linkedom/esm/index.js`);

const APP = "/Users/mike/dev/EnergyLinkFlex/src/lib/dwg";
const { computeViewRegions, viewOf } = await import(`${APP}/view-model.ts`);
const { applyMultiStretch, findModelSpace, fastPosition } = await import(`${APP}/svg-stretch.ts`);
const { isAnnotationElement } = await import(`${APP}/annotations.ts`);

const SVG_PATH = "/Users/mike/dev/elf-lab/24081-CS1-0001_Sheet_2.svg";
const raw = readFileSync(SVG_PATH, "utf8");
const load = () => new DOMParser().parseFromString(raw, "image/svg+xml").documentElement;

let pass = true;
const check = (cond, msg) => { if (!cond) { pass = false; console.log("  FAIL:", msg); } else console.log("  ok:", msg); };

// ── 1. View model: exactly 2 regions with the gutter inside x[816, 977] ──
const regions = computeViewRegions(findModelSpace(load()));
console.log("regions:", JSON.stringify(regions.map((r) => ({ xMin: +r.xMin.toFixed(0), xMax: +r.xMax.toFixed(0) }))));
check(regions.length === 2, `2 view regions found (got ${regions.length})`);
if (regions.length === 2) {
  check(regions[0].xMax < 977 && regions[1].xMin > 816, `gutter brackets x[816,977] (r0.xMax=${regions[0].xMax.toFixed(0)}, r1.xMin=${regions[1].xMin.toFixed(0)})`);
  // near-view stack dim (x~86) -> region 0; end-view 21'-3" dim (x~990) -> region 1
  check(viewOf(86, regions) === regions[0], "near-view dim x=86 -> region 0 (near)");
  check(viewOf(990, regions) === regions[1], "end-view dim x=990 -> region 1 (end)");
}

// ── 2. Height stretch (silencer +48): companion annotations never scale; equipment scales in BOTH views; ok ──
const MID = regions.length === 2 ? (regions[0].xMax + regions[1].xMin) / 2 : 816;
const hasScale = (t) => /scale\((?!1,\s*1\))/.test(t);
{
  const svg = load();
  const sil = { componentId: "sil", direction: "vertical", delta: 48,
    svgBounds: { top: -627.3, bottom: -531.3, left: -1e6, right: 1e6 } };
  const res = applyMultiStretch(svg, [sil]);
  check(res.ok === true, `height stretch returns ok:true (transformed=${res.transformed})`);
  const kids = Array.from(findModelSpace(svg).children);
  let annoScaled = 0, eqNear = 0, eqEnd = 0;
  for (const k of kids) {
    const p = fastPosition(k); if (!p) continue;
    const t = k.getAttribute("transform") || "";
    if (isAnnotationElement(k)) { if (hasScale(t)) annoScaled++; }
    else if (hasScale(t)) { if (p.x < MID) eqNear++; else eqEnd++; }
  }
  check(annoScaled === 0, `no annotation was scaled (got ${annoScaled})`);
  check(eqNear > 0 && eqEnd > 0, `equipment scaled in BOTH views (near=${eqNear}, end=${eqEnd})`);
}

// ── 3. Width stretch scoped to region 0: ZERO transforms land on region-1 elements ──
if (regions.length === 2) {
  const svg = load();
  const wid = { componentId: "duct", direction: "horizontal", delta: 24,
    svgBounds: { top: -1e6, bottom: 1e6, left: regions[0].xMin + 50, right: regions[0].xMin + 150 },
    viewRegion: regions[0] };
  const res = applyMultiStretch(svg, [wid]);
  check(res.ok === true, `width stretch returns ok:true (transformed=${res.transformed})`);
  const kids = Array.from(findModelSpace(svg).children);
  let region1Touched = 0;
  for (const k of kids) {
    const p = fastPosition(k); if (!p) continue;
    if (p.x >= regions[1].xMin && (k.getAttribute("transform") || "") !== "") region1Touched++;
  }
  check(region1Touched === 0, `width stretch left region 1 untouched (touched=${region1Touched})`);
}

// ── 4. Watchdog: a tiny element budget aborts + rolls back (zero markers) ──
{
  const svg = load();
  const sil = { componentId: "sil", direction: "vertical", delta: 48,
    svgBounds: { top: -627.3, bottom: -531.3, left: -1e6, right: 1e6 } };
  const res = applyMultiStretch(svg, [sil], { maxElements: 100 });
  check(res.ok === false, `watchdog aborts on tiny element budget (reason: ${res.reason})`);
  const markers = findModelSpace(svg).querySelectorAll("[data-stretch-transform]").length;
  check(markers === 0, `watchdog rollback left zero transforms (got ${markers})`);
}

console.log(pass ? "\nALL GOLDEN ASSERTIONS PASS" : "\nSOME GOLDEN ASSERTIONS FAILED");
process.exit(pass ? 0 : 1);
