/**
 * Hatch dampening for CAD-derived SVG.
 *
 * CAD HATCH regions arrive tessellated into thousands of very short line
 * segments, each rendered with a fixed 1px black stroke. At low zoom these
 * flood whole regions solid black. `dampenHatch` recolors the stroke of any
 * `<g stroke="..."><line .../></g>` group whose single line is shorter than a
 * threshold to a light gray, so hatch recedes to a faint texture while real
 * geometry (long lines) keeps its original stroke.
 *
 * Pure, deterministic string -> string transform. No DOM, no dependencies.
 */

/** Default max segment length (SVG user units) below which a line is hatch. */
export const HATCH_MAX_LEN: number = 0.35;

/** Light-gray stroke applied to dampened hatch groups. */
export const HATCH_COLOR: string = "rgb(205,205,205)";

export interface DampenHatchOptions {
  /** Length threshold; lines with length < maxLen are dampened. */
  maxLen?: number;
  /** Replacement stroke color for dampened groups. */
  color?: string;
}

/**
 * Matches a `<g ...>` open tag immediately followed (modulo whitespace) by a
 * `<line ...>` tag (self-closing or not). Capture 1 = the `<g ...>` tag,
 * capture 2 = everything from after the g tag through the line tag.
 */
const GROUP_WITH_LINE_RE = /(<g\b[^>]*>)(\s*<line\b[^>]*>)/g;

/** Pulls a numeric attribute (e.g. x1="-3.25") out of a tag string. */
function numAttr(tag: string, name: string): number | null {
  const m = tag.match(
    new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`),
  );
  if (!m) return null;
  const raw = m[1] !== undefined ? m[1] : m[2];
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}

/** Pulls a string attribute (e.g. d="M 0 0") out of a tag string. */
function strAttr(tag: string, name: string): string | null {
  const m = tag.match(
    new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`),
  );
  if (!m) return null;
  return m[1] !== undefined ? m[1] : m[2];
}

/** Rewrites the stroke="..." value on a `<g ...>` tag, preserving all else. */
function recolorStroke(gTag: string, color: string): string {
  return gTag.replace(
    /((?:^|\s)stroke\s*=\s*)(?:"[^"]*"|'[^']*')/,
    (_match, prefix: string) => `${prefix}"${color}"`,
  );
}

/**
 * Injects (or replaces) an inline stroke="color" on an element tag string.
 * If the tag already has a stroke attribute its value is replaced; otherwise
 * a stroke attribute is inserted right after the tag name. Never emits two.
 */
function setElementStroke(tag: string, color: string): string {
  if (/(?:^|\s)stroke\s*=/.test(tag)) return recolorStroke(tag, color);
  return tag.replace(
    /^<(circle|ellipse|path)\b/,
    (_m, name: string) => `<${name} stroke="${color}"`,
  );
}

/** Matches one SVG path command letter plus its argument run. */
const PATH_CMD_RE = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;

/** Matches one number in a path argument run (sign/comma/whitespace separated). */
const PATH_NUM_RE = /[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g;

/** Numbers consumed per repetition of each path command (uppercase key). */
const PATH_PARAM_COUNT: Record<string, number> = {
  M: 2,
  L: 2,
  T: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  A: 7,
  Z: 0,
};

/**
 * Diagonal extent of the bounding box of a path's anchor endpoints.
 *
 * Walks the `d` command list (M/m L/l H/h V/v C/c S/s Q/q T/t A/a Z/z),
 * maintaining a current point from (0,0). Each command's ENDPOINT is an
 * anchor (control points of curves are ignored; only the final x,y of A
 * counts). Subpath starts (M/m targets) are anchors. Returns
 * `hypot(maxX-minX, maxY-minY)` over all anchors, or `null` when the d
 * string yields no anchors (empty / only Z / unparseable) — the safe,
 * non-qualifying default.
 */
function pathAnchorExtent(d: string): number | null {
  let x = 0;
  let y = 0;
  let subX = 0;
  let subY = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let anchors = 0;

  const addAnchor = (ax: number, ay: number): void => {
    if (!Number.isFinite(ax) || !Number.isFinite(ay)) return;
    if (ax < minX) minX = ax;
    if (ay < minY) minY = ay;
    if (ax > maxX) maxX = ax;
    if (ay > maxY) maxY = ay;
    anchors += 1;
  };

  for (const cmdMatch of d.matchAll(PATH_CMD_RE)) {
    const letter = cmdMatch[1];
    const upper = letter.toUpperCase();
    const relative = letter !== upper;
    const nums = (cmdMatch[2].match(PATH_NUM_RE) ?? []).map(Number);

    if (upper === "Z") {
      // Close subpath: current point returns to the subpath start.
      x = subX;
      y = subY;
      continue;
    }

    const count = PATH_PARAM_COUNT[upper];
    // Process full repetitions only; trailing partial chunks are ignored.
    for (let i = 0, rep = 0; i + count <= nums.length; i += count, rep += 1) {
      let ex: number;
      let ey: number;
      if (upper === "H") {
        ex = relative ? x + nums[i] : nums[i];
        ey = y;
      } else if (upper === "V") {
        ex = x;
        ey = relative ? y + nums[i] : nums[i];
      } else {
        // M/L/T/C/S/Q/A: endpoint is the last (x, y) pair of the chunk.
        const px = nums[i + count - 2];
        const py = nums[i + count - 1];
        ex = relative ? x + px : px;
        ey = relative ? y + py : py;
      }
      x = ex;
      y = ey;
      if (upper === "M" && rep === 0) {
        // First pair of an M sets the subpath start (extras act as L).
        subX = ex;
        subY = ey;
      }
      addAnchor(ex, ey);
    }
  }

  if (anchors === 0) return null;
  return Math.hypot(maxX - minX, maxY - minY);
}

/** Matches a `<circle>`, `<ellipse>`, or `<path>` open tag (self-closing or not). */
const SMALL_ELEMENT_RE = /<(circle|ellipse|path)\b[^>]*\/?>/g;

/**
 * Size of a hatch-candidate element in SVG user units, or `null` when the
 * element cannot be measured (missing/invalid attributes) — non-qualifying.
 */
function elementSize(name: string, tag: string): number | null {
  if (name === "circle") {
    const r = numAttr(tag, "r");
    return r === null ? null : 2 * r;
  }
  if (name === "ellipse") {
    const rx = numAttr(tag, "rx");
    const ry = numAttr(tag, "ry");
    if (rx === null || ry === null) return null;
    return 2 * Math.max(rx, ry);
  }
  const d = strAttr(tag, "d");
  return d === null ? null : pathAnchorExtent(d);
}

/**
 * Recolor the stroke of every short-line group in `svg`.
 *
 * A group qualifies when its `<g>` tag carries a `stroke` attribute and its
 * first/only child is a `<line>` whose length `hypot(x2-x1, y2-y1)` is
 * strictly less than `maxLen`. Qualifying groups get their `<g>` stroke value
 * replaced with `color`; everything else is preserved byte-for-byte.
 */
export function dampenHatch(svg: string, opts?: DampenHatchOptions): string {
  const maxLen = opts?.maxLen ?? HATCH_MAX_LEN;
  const color = opts?.color ?? HATCH_COLOR;

  const linePass = svg.replace(GROUP_WITH_LINE_RE, (match, gTag: string, rest: string) => {
    // The group must carry the stroke we're allowed to rewrite.
    if (!/(?:^|\s)stroke\s*=/.test(gTag)) return match;

    const x1 = numAttr(rest, "x1");
    const y1 = numAttr(rest, "y1");
    const x2 = numAttr(rest, "x2");
    const y2 = numAttr(rest, "y2");
    if (x1 === null || y1 === null || x2 === null || y2 === null) return match;

    const length = Math.hypot(x2 - x1, y2 - y1);
    if (length >= maxLen) return match;

    return recolorStroke(gTag, color) + rest;
  });

  // Blob v2: gray small circles / ellipses / paths element-inline. The size
  // gate is geometry-only (never the current stroke color) and the stroke is
  // injected on the element tag itself so it overrides any ancestor <g>
  // stroke across rotate groups without touching siblings.
  return linePass.replace(SMALL_ELEMENT_RE, (tag, name: string) => {
    const size = elementSize(name, tag);
    if (size === null || size >= maxLen) return tag;
    return setElementStroke(tag, color);
  });
}
