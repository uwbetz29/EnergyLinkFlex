/**
 * Single source of truth for "which DWG blocks are annotation clutter vs equipment".
 * Consumed by the render strip (postProcessSvgDom) AND the stretch classifier, so the
 * two never drift. A block referenced by <use href="#name"> is annotation when it is a
 * dimension, border, title block, datum, section-cut marker, projection symbol, or a
 * named callout (center line, critical feature).
 */

/** Exact annotation block names (the render-strip set). */
export const ANNOTATION_BLOCK_NAMES = new Set<string>([
  "CriticalFeature",
  "Datum Identifier1",
  "DatumFilled45",
  "Filled-1",
  "_Closed",
  "Perf Puddle",
  "DESIGN STATE",
  "PRELIMINARY ISSUE",
]);

/** True when a <use> block name (with or without leading '#') is annotation clutter. */
export function isAnnotationBlockName(href: string): boolean {
  const name = href.replace(/^#/, "");
  return (
    ANNOTATION_BLOCK_NAMES.has(name) ||
    name.includes("Border") ||
    name.includes("Title Block") ||
    name.includes("PROJECTION") ||
    name.includes("2dTransSection") ||
    name.startsWith("Datum Identifier")
  );
}

/**
 * True when a Model_Space child is an annotation (dimension, text, callout, symbol)
 * rather than equipment geometry. Equipment = raw geometry not wrapped in a named
 * annotation <use>. Note: unlike the render strip (which KEEPS "CENTER LINE" callouts
 * visible), the stretch classifier treats CENTER LINE as annotation so its label
 * translates rigidly instead of scaling.
 */
export function isAnnotationElement(el: Element): boolean {
  if (el.tagName === "text") return true;
  // Real LibreDWG output wraps every entity in its own <g>, so a standalone text
  // label arrives as <g><text/></g>, never a bare <text>. Hold it rigid too — a
  // scaled label is a stretched, illegible dimension/callout (bug #3).
  if (el.tagName === "g" && el.querySelector?.("text")) return true;
  const useEl = el.tagName === "use" ? el : el.querySelector?.("use") ?? null;
  const href =
    useEl?.getAttribute("href") || useEl?.getAttribute("xlink:href") || "";
  if (!href) return false;
  if (/#?\*D\d+$/.test(href)) return true;             // dimension block
  if (href.replace(/^#/, "").startsWith("CENTER LINE")) return true; // component callout
  return isAnnotationBlockName(href);
}
