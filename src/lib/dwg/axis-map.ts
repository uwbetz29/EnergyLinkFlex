/**
 * Pure, DOM-free nested-zone axis-map composition.
 *
 * Composes N same-axis interval stretches (disjoint OR properly nested) into ONE
 * monotonic, continuous, piecewise-linear coordinate map per axis, per the
 * normative "Composition model" in
 * docs/superpowers/specs/2026-07-06-nested-zone-stretch-design.md.
 *
 * The map is an ordered list of segments in ORIGINAL axis coordinates:
 *   f(c) = mappedStart + (c - start) * scale   for c in [start, end]
 *
 * Invariants of a well-formed map:
 *  - Partition: segments are increasing; regions between/outside segments are
 *    implicit identity ("hole"/tail) regions that ride the accumulated offset.
 *  - Anchoring: the first segment's mappedStart == start (below-map is fixed).
 *  - Continuity: each segment's mappedStart equals the previous segment's mapped
 *    end plus the (identity) width of any hole between them.
 *  - Monotonic when every scale > 0 (a non-positive scale is caught downstream
 *    by checkStretchInvariants, which rolls the whole stretch back).
 *
 * Zero runtime LLM: this is deterministic geometry, durable by construction.
 */

/** Edge-snapping / containment tolerance in SVG units (matches revalue tolerance). */
export const AXIS_TOL = 6;

/** One 1-D stretch interval on a single axis, in original axis coordinates. */
export interface AxisSpec {
  /** Lower edge (scale origin side). */
  near: number;
  /** Upper edge. near < far. */
  far: number;
  /** Growth in axis units (positive = bigger). For a container this is the RESIDUAL. */
  delta: number;
}

/** One linear piece of the composed axis map, in original axis coordinates. */
export interface Segment {
  start: number;
  end: number;
  scale: number;
  mappedStart: number;
}

/**
 * Where a coordinate lands on the map, pre-resolved into the transform pieces
 * the stretch engine needs:
 *  - equipment: `scale`, `translate`  (so c ↦ f(c) exactly)
 *  - annotation: scale 1, `annTranslate` = the segment's near-edge offset
 *    (mappedStart - start): rides the shift accumulated BELOW the segment,
 *    never distorts.
 */
export interface AxisPlacement {
  scale: number;
  translate: number;
  annTranslate: number;
}

const IDENTITY: AxisPlacement = { scale: 1, translate: 0, annTranslate: 0 };

interface Node extends AxisSpec {
  children: Node[];
}

/**
 * Build the composed axis map from same-axis specs.
 *
 * Preconditions (enforced by the caller's classification pass): specs pairwise
 * are either disjoint (overlap <= tol) or properly nested (one contains the
 * other within tol). Coincident specs must already be merged; partial overlaps
 * must already be skipped.
 *
 * Construction: containment forest (each spec's parent = smallest containing
 * spec). A leaf becomes one segment with scale (h + delta) / h. A container
 * partitions into alternating gap / child segments; its (residual) delta is
 * distributed across its exclusive gaps proportional to gap height, giving
 * every gap the same scale (sumGapH + delta) / sumGapH. Gaps with height <= tol
 * are dropped from the partition AND the denominator. A held (delta 0) child
 * naturally yields scale 1 and takes no share of the gap distribution, but
 * still partitions its container.
 */
export function buildAxisMap(specs: AxisSpec[], tol: number = AXIS_TOL): Segment[] {
  // Sort by span descending so every node's potential parents precede it.
  const nodes: Node[] = specs
    .filter((s) => s.far - s.near > 0)
    .map((s) => ({ near: s.near, far: s.far, delta: s.delta, children: [] }));
  nodes.sort((a, b) => (b.far - b.near) - (a.far - a.near));

  const roots: Node[] = [];
  const placed: Node[] = [];
  for (const n of nodes) {
    let parent: Node | null = null;
    for (const p of placed) {
      const contains = p.near <= n.near + tol && p.far >= n.far - tol;
      if (contains && (!parent || p.far - p.near < parent.far - parent.near)) {
        parent = p;
      }
    }
    (parent ? parent.children : roots).push(n);
    placed.push(n);
  }
  roots.sort((a, b) => a.near - b.near);

  // Emit scale-only pieces in original coordinates (depth-first, in order).
  const raw: Array<{ start: number; end: number; scale: number }> = [];
  const emit = (node: Node): void => {
    if (node.children.length === 0) {
      const h = node.far - node.near;
      raw.push({ start: node.near, end: node.far, scale: (h + node.delta) / h });
      return;
    }
    node.children.sort((a, b) => a.near - b.near);

    // Gap heights (child-exclusive regions), tiny gaps dropped from denominator.
    let cursor = node.near;
    let sumGapH = 0;
    for (const ch of node.children) {
      const gh = ch.near - cursor;
      if (gh > tol) sumGapH += gh;
      cursor = Math.max(cursor, ch.far);
    }
    const tailGap = node.far - cursor;
    if (tailGap > tol) sumGapH += tailGap;

    // Proportional-to-height distribution: every gap gets the SAME scale.
    const gapScale = sumGapH > 0 ? (sumGapH + node.delta) / sumGapH : 1;

    cursor = node.near;
    for (const ch of node.children) {
      const gh = ch.near - cursor;
      if (gh > tol) raw.push({ start: cursor, end: ch.near, scale: gapScale });
      emit(ch);
      cursor = Math.max(cursor, ch.far);
    }
    const gh = node.far - cursor;
    if (gh > tol) raw.push({ start: cursor, end: node.far, scale: gapScale });
  };
  for (const r of roots) emit(r);
  raw.sort((a, b) => a.start - b.start);

  // Continuity pass: anchor the first segment, chain mappedStart through
  // segments, treating any hole between pieces as identity width.
  const segments: Segment[] = [];
  let prevEnd = raw.length > 0 ? raw[0].start : 0;
  let prevMappedEnd = prevEnd;
  for (const r of raw) {
    const mappedStart = prevMappedEnd + (r.start - prevEnd);
    segments.push({ start: r.start, end: r.end, scale: r.scale, mappedStart });
    prevEnd = r.end;
    prevMappedEnd = mappedStart + (r.end - r.start) * r.scale;
  }
  return segments;
}

/** Total growth of the map: the tail's accumulated offset above the last segment. */
export function axisGrowth(segments: Segment[]): number {
  if (segments.length === 0) return 0;
  const last = segments[segments.length - 1];
  return last.mappedStart + (last.end - last.start) * last.scale - last.end;
}

/**
 * Resolve a coordinate against the map.
 *  - below the first segment → identity (anchored; no transform needed)
 *  - inside a segment S → equipment scale = S.scale,
 *    translate = S.mappedStart - S.start * S.scale; annotation
 *    annTranslate = S.mappedStart - S.start (scale 1)
 *  - in a hole between segments, or above the last → rigid offset accumulated
 *    below that point (scale 1), for equipment and annotations alike.
 * Boundary points (c exactly on a shared edge) resolve to the LOWER segment;
 * continuity makes the mapped position identical either way.
 */
export function placeOnAxis(segments: Segment[], c: number): AxisPlacement {
  if (segments.length === 0 || c < segments[0].start) return IDENTITY;
  let offsetBelow = 0;
  for (const s of segments) {
    if (c < s.start) {
      return { scale: 1, translate: offsetBelow, annTranslate: offsetBelow };
    }
    if (c <= s.end) {
      const near = s.mappedStart - s.start;
      return { scale: s.scale, translate: s.mappedStart - s.start * s.scale, annTranslate: near };
    }
    offsetBelow = s.mappedStart + (s.end - s.start) * s.scale - s.end;
  }
  return { scale: 1, translate: offsetBelow, annTranslate: offsetBelow };
}

/** Map a single coordinate through the composed map (identity outside/below). */
export function mapPoint(segments: Segment[], c: number): number {
  const p = placeOnAxis(segments, c);
  return c * p.scale + p.translate;
}
