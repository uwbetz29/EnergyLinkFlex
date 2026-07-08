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

/** Rewrites the stroke="..." value on a `<g ...>` tag, preserving all else. */
function recolorStroke(gTag: string, color: string): string {
  return gTag.replace(
    /((?:^|\s)stroke\s*=\s*)(?:"[^"]*"|'[^']*')/,
    (_match, prefix: string) => `${prefix}"${color}"`,
  );
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

  return svg.replace(GROUP_WITH_LINE_RE, (match, gTag: string, rest: string) => {
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
}
