/**
 * SVG stretch/shrink engine for visual dimension modifications.
 *
 * Element-level approach: iterates ALL entities in *Model_Space,
 * classifies each by its Y-position relative to the stretch zone,
 * and applies transforms to each group:
 *   - ABOVE the zone → translate by delta (shift upward)
 *   - IN the zone → scale vertically from the zone's bottom edge
 *   - BELOW the zone → unchanged
 *
 * Trades speed for accuracy: ~2-5s on 75K elements, but every
 * element ends up in exactly the right position.
 *
 * LibreDWG SVG structure:
 *   <svg viewBox="10.8 -1332.14 1610.4 1321.34">
 *     <defs>...</defs>
 *     <g transform="matrix(1,0,0,-1,0,0)">   ← Y-axis flip
 *       <g id="*Model_Space">                  ← 75K children
 *         <g id="hex"><line/></g>
 *         <g id="hex"><path/></g>
 *         ...
 *
 * The Y-flip means internal SVG coords have positive Y = up.
 * viewBox Y goes from -1332 (top) to -11 (bottom).
 * After flip: internal Y ~11 (bottom) to ~1332 (top).
 */

import { isAnnotationElement } from "./annotations";
import { AXIS_TOL, buildAxisMap, axisGrowth, placeOnAxis, type Segment } from "./axis-map";

export interface StretchResult {
  ok: boolean;
  reason?: string;
  transformed: number;
}

/** Safety budgets. The real drawing is ~75k elements and a stretch runs in ~1-2s. */
const DEFAULT_MAX_ELEMENTS = 200_000;
const DEFAULT_MAX_MS = 4_000;
const MIN_SANE_SCALE = 0.02;
const MAX_SANE_SCALE = 50;

export interface StretchParams {
  /** Component ID this stretch applies to */
  componentId: string;
  /** SVG coordinate bounds of the section to stretch (in viewBox space) */
  svgBounds: {
    top: number;    // min Y in viewBox space (visually higher = more negative)
    bottom: number; // max Y in viewBox space (visually lower = less negative)
    left: number;
    right: number;
  };
  /** Stretch direction */
  direction: "vertical" | "horizontal";
  /** Amount to stretch in SVG units (positive = bigger) */
  delta: number;
  /** Width stretches only: confine the stretch to this X-interval (the edited view). */
  viewRegion?: { xMin: number; xMax: number };
}

/**
 * Find the *Model_Space <g> that contains all drawing entities.
 */
export function findModelSpace(svgRoot: SVGSVGElement): SVGGElement | null {
  // Navigate: <svg> → <g transform="matrix(...)"> → <g id="*Model_Space">
  for (const child of Array.from(svgRoot.children)) {
    if (child.tagName === "g" && child.getAttribute("transform")?.includes("matrix")) {
      const ms = child.querySelector("#\\*Model_Space") as SVGGElement | null;
      if (ms) return ms;
      // Fallback: first child <g>
      if (child.children[0]?.tagName === "g") return child.children[0] as SVGGElement;
    }
  }
  return null;
}

/**
 * Save original viewBox for later restoration.
 */
export function saveOriginalViewBox(svgRoot: SVGSVGElement): void {
  const vb = svgRoot.getAttribute("viewBox");
  if (vb && !svgRoot.hasAttribute("data-original-viewbox")) {
    svgRoot.setAttribute("data-original-viewbox", vb);
  }
}

/**
 * Remove all stretches and restore original state.
 */
export function undoStretches(svgRoot: SVGSVGElement): void {
  // Remove transforms applied to Model_Space children
  const modelSpace = findModelSpace(svgRoot);
  if (modelSpace) {
    for (const child of Array.from(modelSpace.children)) {
      if (child.hasAttribute("data-stretch-transform")) {
        child.removeAttribute("transform");
        child.removeAttribute("data-stretch-transform");
      }
    }
  }

  // Restore text inverse-scaling
  const modifiedTexts = svgRoot.querySelectorAll("[data-stretch-text-orig]");
  for (const text of modifiedTexts) {
    const orig = text.getAttribute("data-stretch-text-orig");
    if (orig) {
      text.setAttribute("transform", orig);
    } else {
      text.removeAttribute("transform");
    }
    text.removeAttribute("data-stretch-text-orig");
  }

  // Restore re-valued dimension text (spanning totals) to their original values,
  // so every stretch/undo cycle recomputes from the pristine number.
  const revalued = svgRoot.querySelectorAll("[data-revalue-orig]");
  for (const text of revalued) {
    const orig = text.getAttribute("data-revalue-orig");
    if (orig !== null) text.textContent = orig;
    text.removeAttribute("data-revalue-orig");
  }

  // Restore original viewBox
  const origVb = svgRoot.getAttribute("data-original-viewbox");
  if (origVb) {
    svgRoot.setAttribute("viewBox", origVb);
  }
}

/**
 * Apply a stretch to the SVG by transforming individual elements.
 *
 * For vertical stretches:
 *   - Elements above the zone shift upward by delta
 *   - Elements in the zone scale from the bottom edge
 *   - Elements below the zone stay put
 *
 * The viewBox is expanded to accommodate the growth.
 */
/**
 * Fast position extraction from an SVG element WITHOUT calling getBBox().
 *
 * getBBox() forces a full layout recalculation — on 75K elements that takes 700s+.
 * Instead, parse position from attributes directly:
 *   - <use x="..." y="..."> → (x, y)
 *   - <line x1="..." y1="..."> → midpoint
 *   - <circle cx="..." cy="..."> → (cx, cy)
 *   - <path d="M x y ..."> → first move-to point
 *   - <text x="..." y="..."> → (x, y)
 *   - <g> with children → recurse into first child
 *
 * Returns null if position can't be determined (rare — skip the element).
 */
export function fastPosition(el: Element): { x: number; y: number } | null {
  const tag = el.tagName;

  if (tag === "use" || tag === "text" || tag === "rect" || tag === "image") {
    const x = parseFloat(el.getAttribute("x") || "");
    const y = parseFloat(el.getAttribute("y") || "");
    if (!isNaN(x) && !isNaN(y)) return { x, y };
  }

  if (tag === "line") {
    const x1 = parseFloat(el.getAttribute("x1") || "");
    const y1 = parseFloat(el.getAttribute("y1") || "");
    const x2 = parseFloat(el.getAttribute("x2") || "");
    const y2 = parseFloat(el.getAttribute("y2") || "");
    if (!isNaN(x1) && !isNaN(y1) && !isNaN(x2) && !isNaN(y2)) {
      return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
    }
  }

  if (tag === "circle" || tag === "ellipse") {
    const cx = parseFloat(el.getAttribute("cx") || "");
    const cy = parseFloat(el.getAttribute("cy") || "");
    if (!isNaN(cx) && !isNaN(cy)) return { x: cx, y: cy };
  }

  if (tag === "path") {
    const d = el.getAttribute("d") || "";
    const m = d.match(/[Mm]\s*([-\d.e]+)[,\s]+([-\d.e]+)/);
    if (m) return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
  }

  if (tag === "polygon" || tag === "polyline") {
    const pts = el.getAttribute("points") || "";
    const firstPair = pts.trim().split(/[\s,]+/);
    if (firstPair.length >= 2) {
      return { x: parseFloat(firstPair[0]), y: parseFloat(firstPair[1]) };
    }
  }

  // <g> wrapper → check first child
  if (tag === "g" && el.children.length > 0) {
    return fastPosition(el.children[0]);
  }

  return null;
}

export function applySvgStretch(
  svgRoot: SVGSVGElement,
  params: StretchParams
): void {
  const { svgBounds, direction, delta } = params;
  if (Math.abs(delta) < 0.01) return;

  const modelSpace = findModelSpace(svgRoot);
  if (!modelSpace) {
    console.warn("[ELF stretch] Could not find *Model_Space");
    return;
  }

  // Parse current viewBox
  const vb = svgRoot.getAttribute("viewBox")?.split(/\s+/).map(Number);
  if (!vb || vb.length !== 4) return;
  const [vbX, vbY, vbW, vbH] = vb;

  const children = Array.from(modelSpace.children) as SVGGElement[];
  const t0 = performance.now();
  const classified = { above: 0, inZone: 0, below: 0, skipped: 0 };

  if (direction === "vertical") {
    // Convert viewBox bounds to internal (Y-flipped) coordinates
    const internalZoneTop = -svgBounds.top;       // higher Y = higher on screen
    const internalZoneBottom = -svgBounds.bottom;  // lower Y = lower on screen

    const zoneHeight = internalZoneTop - internalZoneBottom;
    if (zoneHeight <= 0) return;

    const scaleY = (zoneHeight + delta) / zoneHeight;
    const originY = internalZoneBottom;

    for (const child of children) {
      const pos = fastPosition(child);
      if (!pos) { classified.skipped++; continue; }

      // pos.y is in Model_Space coords (Y-up)
      const cy = pos.y;

      if (cy > internalZoneTop) {
        // ABOVE the stretch zone → shift upward by delta
        child.setAttribute("transform", `translate(0, ${delta})`);
        child.setAttribute("data-stretch-transform", "true");
        classified.above++;
      } else if (cy >= internalZoneBottom) {
        // IN the stretch zone → scale vertically from bottom edge
        child.setAttribute(
          "transform",
          `translate(0, ${originY * (1 - scaleY)}) scale(1, ${scaleY})`
        );
        child.setAttribute("data-stretch-transform", "true");
        classified.inZone++;
      } else {
        // BELOW the stretch zone → no change
        classified.below++;
      }
    }

    // Expand viewBox to accommodate growth
    svgRoot.setAttribute("viewBox", `${vbX} ${vbY - delta} ${vbW} ${vbH + delta}`);
  } else {
    // Horizontal stretch — svgBounds.left/right are in Model_Space X coords (no flip)
    const zoneLeft = svgBounds.left;
    const zoneRight = svgBounds.right;
    const zoneWidth = zoneRight - zoneLeft;
    if (zoneWidth <= 0) return;

    const scaleX = (zoneWidth + delta) / zoneWidth;
    const originX = zoneLeft;

    for (const child of children) {
      const pos = fastPosition(child);
      if (!pos) { classified.skipped++; continue; }

      const cx = pos.x;

      if (cx > zoneRight) {
        // RIGHT of stretch zone → shift right
        child.setAttribute("transform", `translate(${delta}, 0)`);
        child.setAttribute("data-stretch-transform", "true");
        classified.above++;
      } else if (cx >= zoneLeft) {
        // IN the stretch zone → scale horizontally
        child.setAttribute(
          "transform",
          `translate(${originX * (1 - scaleX)}, 0) scale(${scaleX}, 1)`
        );
        child.setAttribute("data-stretch-transform", "true");
        classified.inZone++;
      } else {
        classified.below++;
      }
    }

    svgRoot.setAttribute("viewBox", `${vbX} ${vbY} ${vbW + delta} ${vbH}`);
  }

  const elapsed = Math.round(performance.now() - t0);
  console.log(
    `[ELF stretch] ${children.length} elements classified in ${elapsed}ms:`,
    `above=${classified.above} inZone=${classified.inZone} below=${classified.below} skipped=${classified.skipped}`,
    `delta=${delta.toFixed(1)} direction=${direction}`
  );
}

/**
 * Caller policy for nested edits: convert each container spec's delta to its
 * RESIDUAL before it reaches applyMultiStretch. When a salesperson edits a
 * spanning total (e.g. overall 50'->54', +48) AND a component inside it (silencer
 * 8'->10', +24) in the same pass, the engine's redistribute contract expects the
 * container to carry only the growth NOT already produced by its children
 * (48 - 24 = 24). Without this, the container's full delta is distributed across
 * the gaps ON TOP of the child growth and the total overshoots (54' -> 56').
 *
 * A residual subtracts only IMMEDIATE same-axis children (the smallest containing
 * spec is each child's parent), so arbitrary nesting depth stays consistent:
 * total growth of a region equals the outermost spec's edited delta. Disjoint
 * specs (the common component-only edit) are returned unchanged.
 */
export function resolveContainerResiduals(stretches: StretchParams[]): StretchParams[] {
  const interval = (s: StretchParams) =>
    s.direction === "vertical"
      ? { near: -s.svgBounds.bottom, far: -s.svgBounds.top }
      : { near: s.svgBounds.left, far: s.svgBounds.right };
  const strictlyContains = (a: StretchParams, b: StretchParams) => {
    if (a === b || a.direction !== b.direction) return false;
    const ai = interval(a), bi = interval(b);
    const aInB = bi.near <= ai.near + AXIS_TOL && bi.far >= ai.far - AXIS_TOL;
    const bInA = ai.near <= bi.near + AXIS_TOL && ai.far >= bi.far - AXIS_TOL;
    return bInA && !aInB; // a contains b, and not coincident
  };
  const isImmediateChild = (parent: StretchParams, child: StretchParams) =>
    strictlyContains(parent, child) &&
    !stretches.some((mid) => mid !== parent && mid !== child && strictlyContains(parent, mid) && strictlyContains(mid, child));

  return stretches.map((s) => {
    let childSum = 0;
    for (const o of stretches) if (isImmediateChild(s, o)) childSum += o.delta;
    return childSum !== 0 ? { ...s, delta: s.delta - childSum } : s;
  });
}

/**
 * Apply MULTIPLE stretches in a single pass, COMPOSING each element's transform
 * instead of overwriting it. applySvgStretch() does setAttribute("transform", …),
 * so calling it per-dimension makes the last write win on any shared element —
 * that is why the caller used to break after one dim. This composes instead.
 *
 * Each stretch acts on ONE axis and X/Y are independent, so an element's net
 * transform is `translate(tx,ty) scale(sx,sy)`, accumulated over the stretches:
 *   - after a zone (higher coord)  → translate by that stretch's delta
 *   - inside a zone                → scale about the zone's near edge
 *   - before a zone (lower coord)  → no effect
 * fastPosition() reads geometry attributes (never the transform), so every zone
 * classifies against ORIGINAL coords. That makes the result exact and
 * order-independent for mixed-axis stretches and any same-axis set of zones
 * that are pairwise DISJOINT or properly NESTED: those compose into ONE
 * monotonic piecewise-linear coordinate map per axis (see ./axis-map.ts and
 * docs/superpowers/specs/2026-07-06-nested-zone-stretch-design.md). A container
 * zone distributes its (residual) delta across the exclusive gaps between its
 * children, proportional to gap height; a held (delta 0) child stays fixed but
 * still partitions its container. Coincident zones (equal within tolerance)
 * merge with summed deltas. Only PARTIAL overlaps (neither contains the other)
 * remain ambiguous: the later spec of such a pair is skipped with a warning,
 * as is any overlapping horizontal pair with mismatched viewRegions.
 */
export function applyMultiStretch(
  svgRoot: SVGSVGElement,
  stretches: StretchParams[],
  opts: { maxElements?: number; maxMs?: number } = {}
): StretchResult {
  const maxElements = opts.maxElements ?? DEFAULT_MAX_ELEMENTS;
  const maxMs = opts.maxMs ?? DEFAULT_MAX_MS;

  // All-no-op fast path (a zero-delta spec only matters as a held child of a
  // NONZERO container, so an all-zero set can never produce a transform).
  if (stretches.every((s) => Math.abs(s.delta) < 0.01))
    return { ok: true, transformed: 0 };

  const modelSpace = findModelSpace(svgRoot);
  if (!modelSpace) {
    console.warn("[ELF stretch] Could not find *Model_Space");
    return { ok: false, reason: "no model space", transformed: 0 };
  }

  // Keep the RAW viewBox string for a self-contained rollback (independent of
  // saveOriginalViewBox / data-original-viewbox), plus the parsed numbers.
  const vbStr = svgRoot.getAttribute("viewBox");
  const vb = vbStr?.split(/\s+/).map(Number);
  if (!vb || vb.length !== 4 || vb.some((n) => !Number.isFinite(n)))
    return { ok: false, reason: "bad viewBox", transformed: 0 };
  const [vbX, vbY, vbW, vbH] = vb;

  // Normalize each stretch to a 1D interval along its axis, in Model_Space coords.
  // vertical: internal Y = -(viewBox Y) due to the matrix(1,0,0,-1) flip.
  type Spec = { axis: "x" | "y"; near: number; far: number; delta: number;
                viewRegion?: { xMin: number; xMax: number } };
  const rawSpecs: Spec[] = [];
  for (const s of stretches) {
    if (s.direction === "vertical") {
      const far = -s.svgBounds.top;      // internal Y increases upward
      const near = -s.svgBounds.bottom;  // near edge = scale origin
      if (far - near <= 0) continue;
      rawSpecs.push({ axis: "y", near, far, delta: s.delta, viewRegion: s.viewRegion });
    } else {
      const near = s.svgBounds.left;
      const far = s.svgBounds.right;
      if (far - near <= 0) continue;
      rawSpecs.push({ axis: "x", near, far, delta: s.delta, viewRegion: s.viewRegion });
    }
  }

  // Zero-delta filtering: drop no-op specs UNLESS they participate in a nesting
  // relationship with a nonzero-delta spec on the same axis — a held (delta 0)
  // child of a container carrying residual, or a container of a nonzero child.
  // Held children must survive so they partition the container's gaps.
  const contains = (a: Spec, b: Spec) =>
    a.near <= b.near + AXIS_TOL && a.far >= b.far - AXIS_TOL;
  const specs = rawSpecs.filter(
    (sp) =>
      Math.abs(sp.delta) >= 0.01 ||
      rawSpecs.some(
        (o) =>
          o !== sp && o.axis === sp.axis && Math.abs(o.delta) >= 0.01 &&
          (contains(o, sp) || contains(sp, o))
      )
  );
  if (specs.length === 0) return { ok: true, transformed: 0 };

  // Nesting classification (after TOL snapping): disjoint zones compose freely;
  // coincident zones MERGE (summed delta); properly nested zones compose via the
  // axis map; PARTIAL overlaps (and overlapping horizontals with mismatched
  // viewRegions) keep the earlier spec and skip the later one with a warning.
  const regionKey = (sp: Spec) =>
    sp.viewRegion ? `${sp.viewRegion.xMin}:${sp.viewRegion.xMax}` : "";
  const kept: Spec[] = [];
  for (const sp of specs) {
    let skip = false;
    let merged = false;
    for (const k of kept) {
      if (k.axis !== sp.axis) continue;
      const overlap = Math.min(k.far, sp.far) - Math.max(k.near, sp.near);
      if (overlap <= AXIS_TOL) continue; // disjoint
      if (regionKey(k) !== regionKey(sp)) { skip = true; break; } // mismatched view scope
      const kHasSp = contains(k, sp);
      const spHasK = contains(sp, k);
      if (kHasSp && spHasK) {
        // coincident: merge into the (larger) kept bounds with summed delta
        k.near = Math.min(k.near, sp.near);
        k.far = Math.max(k.far, sp.far);
        k.delta += sp.delta;
        merged = true;
        break;
      }
      if (kHasSp || spHasK) continue; // nested: the axis map composes it
      skip = true; // partial overlap: not physically meaningful
      break;
    }
    if (skip) {
      console.warn(
        `[ELF stretch] skipping partially-overlapping ${sp.axis}-zone [${sp.near.toFixed(0)}, ${sp.far.toFixed(0)}] ` +
          `(neither zone contains the other, or viewRegions mismatch)`
      );
      continue;
    }
    if (!merged) kept.push(sp);
  }
  if (kept.length === 0) return { ok: true, transformed: 0 };

  // Build ONE composed piecewise-linear map per (axis, viewRegion) group.
  type AxisGroup = { axis: "x" | "y"; viewRegion?: { xMin: number; xMax: number };
                     segments: Segment[] };
  const groupMap = new Map<string, Spec[]>();
  for (const sp of kept) {
    const key = `${sp.axis}|${regionKey(sp)}`;
    const list = groupMap.get(key);
    if (list) list.push(sp);
    else groupMap.set(key, [sp]);
  }
  const groups: AxisGroup[] = [];
  let sumV = 0, sumH = 0;
  for (const list of groupMap.values()) {
    const segments = buildAxisMap(
      list.map((sp) => ({ near: sp.near, far: sp.far, delta: sp.delta }))
    );
    if (segments.length === 0) continue;
    groups.push({ axis: list[0].axis, viewRegion: list[0].viewRegion, segments });
    // viewBox growth derives from the map's tail (not a blind delta sum), so it
    // stays consistent with the geometry even when a container's delta is residual.
    const growth = axisGrowth(segments);
    if (list[0].axis === "y") sumV += growth;
    else sumH += growth;
  }
  if (groups.length === 0) return { ok: true, transformed: 0 };

  const children = Array.from(modelSpace.children) as SVGGElement[];

  // WATCHDOG (pre): element budget.
  if (children.length > maxElements)
    return { ok: false, reason: `element budget exceeded (${children.length} > ${maxElements})`, transformed: 0 };

  // Self-contained rollback: restore geometry AND the original viewBox string, so the
  // safety net does not depend on the caller having called saveOriginalViewBox.
  const rollback = () => {
    undoStretches(svgRoot);
    if (vbStr) svgRoot.setAttribute("viewBox", vbStr);
  };

  const t0 = performance.now();
  let transformed = 0;

  for (let i = 0; i < children.length; i++) {
    // WATCHDOG (mid): time budget.
    if ((i & 8191) === 0 && performance.now() - t0 > maxMs) {
      rollback();
      return { ok: false, reason: `watchdog timeout after ${Math.round(performance.now() - t0)}ms`, transformed: 0 };
    }
    const child = children[i];
    const pos = fastPosition(child);
    if (!pos) continue;
    const annotation = isAnnotationElement(child);

    let sx = 1, sy = 1, tx = 0, ty = 0;
    for (const g of groups) {
      // Width scoping: skip elements outside the edited view.
      if (g.viewRegion && (pos.x < g.viewRegion.xMin || pos.x > g.viewRegion.xMax)) continue;

      const c = g.axis === "y" ? pos.y : pos.x;
      const p = placeOnAxis(g.segments, c);
      // Annotations NEVER scale: they ride their segment's near-edge offset
      // (the shift accumulated below the segment). Equipment maps exactly: c ↦ f(c).
      const sc = annotation ? 1 : p.scale;
      const t = annotation ? p.annTranslate : p.translate;
      if (g.axis === "y") { sy *= sc; ty += t; }
      else { sx *= sc; tx += t; }
    }

    if (sx !== 1 || sy !== 1 || tx !== 0 || ty !== 0) {
      child.setAttribute("transform", `translate(${tx}, ${ty}) scale(${sx}, ${sy})`);
      child.setAttribute("data-stretch-transform", "true");
      transformed++;
    }
  }

  // Grow the viewBox: top by summed vertical deltas, right by summed horizontal.
  svgRoot.setAttribute(
    "viewBox",
    `${vbX} ${vbY - sumV} ${vbW + sumH} ${vbH + sumV}`
  );

  const elapsed = Math.round(performance.now() - t0);
  console.log(
    `[ELF stretch] ${kept.length} zone(s) composed over ${children.length} elements in ${elapsed}ms:`,
    `transformed=${transformed} sumV=${sumV.toFixed(1)} sumH=${sumH.toFixed(1)}`
  );

  // INVARIANTS (post): if anything is off, roll back to the prior known-good geometry.
  const invariantError = checkStretchInvariants(svgRoot, modelSpace, children.length, vb);
  if (invariantError) {
    rollback();
    return { ok: false, reason: invariantError, transformed: 0 };
  }
  return { ok: true, transformed };
}

/** Returns an error string if any post-stretch invariant is violated, else null. */
function checkStretchInvariants(
  svgRoot: SVGSVGElement,
  modelSpace: Element,
  originalChildCount: number,
  origVb: number[]
): string | null {
  if (modelSpace.children.length !== originalChildCount)
    return `child count changed (${originalChildCount} -> ${modelSpace.children.length})`;

  const transformedEls = modelSpace.querySelectorAll("[data-stretch-transform]");
  for (const el of transformedEls) {
    const t = el.getAttribute("transform") || "";
    const tr = t.match(/translate\(\s*([-\d.eE]+)\s*,\s*([-\d.eE]+)\s*\)/);
    const sc = t.match(/scale\(\s*([-\d.eE]+)\s*,\s*([-\d.eE]+)\s*\)/);
    const nums = [tr?.[1], tr?.[2], sc?.[1], sc?.[2]].filter((v) => v != null).map(Number);
    if (nums.some((n) => !Number.isFinite(n))) return "non-finite transform value";
    if (sc) {
      for (const s of [+sc[1], +sc[2]]) {
        if (s === 1) continue;
        // A non-positive scale mirrors or collapses the geometry — visually corrupt,
        // and NOT caught by the viewBox-area check when a concurrent grow dominates.
        if (s <= 0) return `non-positive (mirrored) scale (${s})`;
        if (s < MIN_SANE_SCALE || s > MAX_SANE_SCALE) return `scale out of bounds (${s})`;
      }
    }
  }

  const vb = svgRoot.getAttribute("viewBox")?.split(/\s+/).map(Number);
  if (!vb || vb.length !== 4 || vb.some((n) => !Number.isFinite(n))) return "viewBox became non-finite";
  if (vb[2] * vb[3] < origVb[2] * origVb[3] - 1e-6) return "viewBox area shrank";

  return null;
}

/* ─── Dimension Parsing ─── */

/**
 * Parse engineering dimension string to decimal inches.
 * Handles: 10'-10 7/8", 15'-0 1/8", ~25'-0", 2'-10 7/8", 9'-8 3/4"
 */
export function parseDimInches(s: string): number | null {
  if (typeof s !== "string") return null; // defensive: cascade/display paths can pass undefined
  const clean = s.replace(/^[~Ø]/, "").trim().replace(/[""\u2033]$/, "");

  const m = clean.match(/(\d+)['\u2018\u2032][- ]?(\d+)?(?:\s+(\d+)\/(\d+))?/);
  if (m) {
    const feet = parseInt(m[1]);
    const inches = parseInt(m[2] || "0");
    const fracNum = parseInt(m[3] || "0");
    const fracDen = parseInt(m[4] || "1");
    return feet * 12 + inches + (fracDen > 0 ? fracNum / fracDen : 0);
  }

  const num = parseFloat(clean);
  if (!isNaN(num)) return num;

  return null;
}

/**
 * Upper sanity bound (inches) for a dimension value. This is a garbage-catcher
 * for hallucinated/absurd values (e.g. a raw coordinate), NOT an engineering
 * limit: ~8333 ft, far above any real SCR/CO system. Oversize-but-plausible
 * values are already governed by the stretch safety net's scale cap.
 */
export const MAX_SANE_DIM_INCHES = 100_000;

export interface DimValidation {
  ok: boolean;
  inches?: number;
  reason?: string;
}

/**
 * Validate a dimension value BEFORE it reaches the store / stretch engine.
 * Rejects the zone-independent corruption sources so AI-cascade values that
 * would collapse or garble the drawing are dropped at the source (the stretch
 * safety net remains the backstop for zone-dependent mirror/collapse cases).
 */
export function validateDimValue(value: string): DimValidation {
  if (typeof value !== "string" || value.trim() === "") {
    return { ok: false, reason: "empty dimension value" };
  }
  const inches = parseDimInches(value);
  if (inches === null) {
    return { ok: false, reason: `unparseable dimension "${value}"` };
  }
  if (!Number.isFinite(inches)) {
    return { ok: false, reason: `non-finite dimension "${value}"` };
  }
  if (inches <= 0) {
    return { ok: false, reason: `non-positive dimension "${value}" (${inches}")` };
  }
  if (inches > MAX_SANE_DIM_INCHES) {
    return { ok: false, reason: `implausibly large dimension "${value}" (${inches}")` };
  }
  return { ok: true, inches };
}

/**
 * Format decimal inches to engineering dimension string.
 */
export function formatDimInches(totalInches: number): string {
  const feet = Math.floor(totalInches / 12);
  const remainInches = totalInches - feet * 12;
  const wholeInches = Math.floor(remainInches);
  const frac = remainInches - wholeInches;

  if (Math.abs(frac) < 0.001) {
    return `${feet}'-${wholeInches}"`;
  }

  const denoms = [16, 8, 4, 2];
  for (const d of denoms) {
    const n = Math.round(frac * d);
    if (Math.abs(n / d - frac) < 0.002 && n > 0 && n < d) {
      let num = n;
      let den = d;
      while (num % 2 === 0 && den % 2 === 0) {
        num /= 2;
        den /= 2;
      }
      return `${feet}'-${wholeInches} ${num}/${den}"`;
    }
  }

  return `${feet}'-${remainInches.toFixed(2)}"`;
}

/**
 * Determine stretch direction from a dimension key.
 */
export function dimKeyToDirection(
  dimKey: string
): "vertical" | "horizontal" | null {
  const k = dimKey.toLowerCase();
  if (k.includes("y scale") || k.includes("height") || k.includes("tall")) {
    return "vertical";
  }
  if (
    k.includes("x scale") ||
    k.includes("width") ||
    k.includes("length") ||
    k.includes("wide")
  ) {
    return "horizontal";
  }
  return null;
}

/**
 * Compute SVG coordinate bounds for a component from its percentage-based box
 * and the SVG viewBox.
 */
export function boxToSvgBounds(
  box: [number, number, number, number],
  viewBox: { minX: number; minY: number; width: number; height: number }
): StretchParams["svgBounds"] {
  return {
    left: viewBox.minX + (box[0] / 100) * viewBox.width,
    top: viewBox.minY + (box[1] / 100) * viewBox.height,
    right: viewBox.minX + ((box[0] + box[2]) / 100) * viewBox.width,
    bottom: viewBox.minY + ((box[1] + box[3]) / 100) * viewBox.height,
  };
}

/**
 * Compute stretch delta from old/new dimension values and section size.
 * Returns delta in SVG units.
 */
export function computeStretchDelta(
  oldValue: string,
  newValue: string,
  sectionSize: number
): number {
  const oldInches = parseDimInches(oldValue);
  const newInches = parseDimInches(newValue);

  if (oldInches === null || newInches === null || oldInches === 0) return 0;

  const ratio = newInches / oldInches;
  return sectionSize * (ratio - 1);
}
