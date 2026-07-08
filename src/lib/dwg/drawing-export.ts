/**
 * Export the LIVE drawing (current stretches + red markups) to PNG or a branded
 * PDF stamped with the title block.
 *
 * The editor renders two sibling <svg>s inside one translate-only transform
 * wrapper (see svg-drawing-canvas.tsx): the drawing svg (class `.elf-dwg`, its
 * own — possibly post-stretch — viewBox) and the markup overlay svg (same box).
 * Both fill the identical pixel rectangle, so we reproduce exactly what's on
 * screen by rasterizing each to the same WxH and compositing markups over the
 * drawing on one canvas. No coordinate math is needed; a stretch that grows the
 * drawing viewBox is captured because we serialize each svg's live state.
 *
 * The pure helpers (size math, title-block field assembly, filename) are unit
 * tested; the browser raster + PDF glue is verified live.
 */

import type { DwgTitleBlock } from "./types";
import { buildChangeLedger } from "./change-ledger";
import { buildDimensionsTable } from "./dimensions-table";

/* ─── Pure helpers (unit-tested) ─── */

/** Longest side of the raster, in px. High enough for a crisp bid drawing while
 *  bounding memory + PDF size. */
export const EXPORT_MAX_PX = 3000;

export interface ExportViewBox {
  width: number;
  height: number;
}

/** Raster pixel size preserving the viewBox aspect, longest side capped at
 *  maxPx. Degenerate (zero/NaN) viewBoxes fall back to a square. */
export function computeExportSize(
  vb: ExportViewBox,
  maxPx: number
): { w: number; h: number } {
  const { width, height } = vb;
  if (!(width > 0) || !(height > 0)) return { w: maxPx, h: maxPx };
  if (width >= height) {
    return { w: maxPx, h: Math.round((maxPx * height) / width) };
  }
  return { w: Math.round((maxPx * width) / height), h: maxPx };
}

export interface TitleBlockFields {
  drawingNumber: string;
  title: string;
  customer: string;
  company: string;
  scale: string;
  revision: string;
  date: string;
  project: string;
}

const MISSING = "N/A";

/** Trim to a non-empty string, or the fallback. */
function orElse(v: string | null | undefined, fallback: string): string {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : fallback;
}

/** Assemble the title-block stamp from parsed DWG metadata, with sales-safe
 *  fallbacks (never leave a blank field on a bid). `dateStr` is passed in so
 *  the result is deterministic. */
export function buildTitleBlock(
  metadata: DwgTitleBlock | null,
  projectName: string | null,
  dateStr: string
): TitleBlockFields {
  const project = orElse(projectName, MISSING);
  return {
    drawingNumber: orElse(metadata?.drawingNumber, MISSING),
    title: orElse(metadata?.title, orElse(projectName, "Untitled")),
    customer: orElse(metadata?.customer, MISSING),
    company: orElse(metadata?.company, MISSING),
    scale: orElse(metadata?.scale, MISSING),
    revision: orElse(metadata?.revision, MISSING),
    date: dateStr,
    project,
  };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Local-time YYYYMMDD-HHMM stamp for versioned filenames. */
export function exportTimestamp(date: Date): string {
  return (
    `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}` +
    `-${pad2(date.getHours())}${pad2(date.getMinutes())}`
  );
}

/** Readable calendar date (YYYY-MM-DD) for the title-block DATE field. */
export function formatDisplayDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Clip a string to a max length with an ellipsis (keeps PDF header fields on one line). */
function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Filesystem-safe slug; falls back to "drawing" for empty/symbol-only input. */
export function slugify(s: string): string {
  const out = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return out.length > 0 ? out : "drawing";
}

/** Versioned, never-overwriting filename: `<slug>_<timestamp>.<ext>`. */
export function exportFilename(base: string, date: Date, ext: string): string {
  return `${slugify(base)}_${exportTimestamp(date)}.${ext}`;
}

/* ─── Browser raster + download (verified live) ─── */

/** Serialize an <svg> to a standalone, sized SVG document string: strip the
 *  root width/height/style (which are `100%` on screen) and stamp explicit px
 *  dimensions + xmlns so it rasterizes at a fixed size. Inner content and the
 *  drawing's scoped `<style>` child are untouched. */
function serializeSizedSvg(svgEl: SVGSVGElement, w: number, h: number): string {
  const raw = svgEl.outerHTML;
  return raw.replace(/^<svg\b[^>]*>/i, (tag) => {
    let t = tag
      .replace(/\swidth="[^"]*"/gi, "")
      .replace(/\sheight="[^"]*"/gi, "")
      .replace(/\sstyle="[^"]*"/gi, "");
    if (!/\sxmlns=/i.test(t)) {
      t = t.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    return t.replace(/^<svg/i, `<svg width="${w}" height="${h}"`);
  });
}

/** Rasterize a serialized SVG string onto an existing 2D context at (0,0,w,h). */
function drawSvgOnto(
  ctx: CanvasRenderingContext2D,
  svgString: string,
  w: number,
  h: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgString], {
      type: "image/svg+xml;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        ctx.drawImage(img, 0, 0, w, h);
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to rasterize drawing SVG"));
    };
    img.src = url;
  });
}

/** Composite the drawing + markup svgs onto one white-backed canvas at WxH. */
async function renderComposite(
  drawingSvg: SVGSVGElement,
  markupSvg: SVGSVGElement | null,
  w: number,
  h: number
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  // White paper background (the drawing's CSS `background:white` doesn't
  // reliably paint when the svg is rasterized as an image).
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);

  await drawSvgOnto(ctx, serializeSizedSvg(drawingSvg, w, h), w, h);
  if (markupSvg) {
    await drawSvgOnto(ctx, serializeSizedSvg(markupSvg, w, h), w, h);
  }
  return canvas;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob returned null"))),
      type,
      quality
    );
  });
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has grabbed the URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface ExportOptions {
  drawingSvg: SVGSVGElement;
  markupSvg: SVGSVGElement | null;
  viewBox: ExportViewBox;
  metadata: DwgTitleBlock | null;
  projectName: string | null;
  /** Injected for determinism + so the stamp and filename agree. */
  date: Date;
  /** Bid package only: current components (dims table) + originals (change ledger). */
  components?: Record<string, { name: string; type: string; dims: Record<string, string> }>;
  originals?: Record<string, Record<string, string>>;
}

/** Export the composed drawing as a PNG download. */
export async function exportDrawingPng(opts: ExportOptions): Promise<void> {
  const { w, h } = computeExportSize(opts.viewBox, EXPORT_MAX_PX);
  const canvas = await renderComposite(opts.drawingSvg, opts.markupSvg, w, h);
  const blob = await canvasToBlob(canvas, "image/png");
  const base =
    orElse(opts.metadata?.drawingNumber, "") ||
    orElse(opts.projectName, "drawing");
  triggerDownload(blob, exportFilename(base, opts.date, "png"));
}

/** Draw the branded header band (wordmark + title-block fields) and return the
 *  Y offset where the drawing image should begin. jsPDF units are points. */
function drawPdfHeader(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdf: any,
  tb: TitleBlockFields,
  pageW: number,
  margin: number
): number {
  const top = margin;
  // Wordmark
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(15);
  pdf.setTextColor(0, 46, 129); // #002e81 EnergyLink navy
  pdf.text("ENERGYLINK FLEX", margin, top + 6);

  // Drawing title (right-aligned; clipped so it can't wrap into the field row
  // or run left into the wordmark).
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(60, 60, 60);
  pdf.text(clip(tb.title, 64), pageW - margin, top + 6, { align: "right" });

  // Field row
  const fieldY = top + 26;
  const fields: [string, string][] = [
    ["DRAWING #", tb.drawingNumber],
    ["CUSTOMER", tb.customer],
    ["SCALE", tb.scale],
    ["REV", tb.revision],
    ["DATE", tb.date],
  ];
  const colW = (pageW - margin * 2) / fields.length;
  fields.forEach(([label, value], i) => {
    const x = margin + colW * i;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(6.5);
    pdf.setTextColor(120, 120, 120);
    pdf.text(label, x, fieldY);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9.5);
    pdf.setTextColor(20, 20, 20);
    // Clip to a single line so a long value can't wrap down through the rule.
    pdf.text(clip(value, 24), x, fieldY + 12);
  });

  // Rule under the header
  const ruleY = fieldY + 22;
  pdf.setDrawColor(0, 46, 129);
  pdf.setLineWidth(1);
  pdf.line(margin, ruleY, pageW - margin, ruleY);
  return ruleY + 10;
}

interface DrawingPdf {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdf: any;
  pageW: number;
  pageH: number;
  margin: number;
  tb: TitleBlockFields;
}

/** Build the drawing PAGE (title-block header + fitted composite raster) and
 *  return the open jsPDF doc so callers can save it or append more pages. */
async function buildDrawingPdf(opts: ExportOptions): Promise<DrawingPdf> {
  const { w, h } = computeExportSize(opts.viewBox, EXPORT_MAX_PX);
  const canvas = await renderComposite(opts.drawingSvg, opts.markupSvg, w, h);
  const pngDataUrl = canvas.toDataURL("image/png");

  const tb = buildTitleBlock(
    opts.metadata,
    opts.projectName,
    formatDisplayDate(opts.date)
  );

  const { jsPDF } = await import("jspdf");
  const margin = 40;
  // Tabloid (11x17") in points, oriented to the drawing.
  const landscape = w >= h;
  const pageW = landscape ? 1224 : 792;
  const pageH = landscape ? 792 : 1224;
  const pdf = new jsPDF({
    orientation: landscape ? "landscape" : "portrait",
    unit: "pt",
    format: [pageW, pageH],
    // Deflate content streams. The drawing image is deflated separately via the
    // addImage `compression` arg below — without it jsPDF stores the raster's
    // RGB data raw (~22MB for a 3000px line drawing); DEFLATE on mostly-white
    // line art shrinks it by ~20x.
    compress: true,
  });

  const imgTop = drawPdfHeader(pdf, tb, pageW, margin);

  // Fit the drawing into the remaining content rect, preserving aspect.
  const areaW = pageW - margin * 2;
  const areaH = pageH - imgTop - margin;
  const imgAspect = w / h;
  let dw = areaW;
  let dh = dw / imgAspect;
  if (dh > areaH) {
    dh = areaH;
    dw = dh * imgAspect;
  }
  const dx = margin + (areaW - dw) / 2;
  const dy = imgTop + (areaH - dh) / 2;
  // "FAST" = DEFLATE the image XObject (see the compress note above).
  pdf.addImage(pngDataUrl, "PNG", dx, dy, dw, dh, undefined, "FAST");

  return { pdf, pageW, pageH, margin, tb };
}

function exportBaseName(opts: ExportOptions): string {
  return (
    orElse(opts.metadata?.drawingNumber, "") ||
    orElse(opts.projectName, "drawing")
  );
}

/** Export the composed drawing as a branded PDF stamped with the title block. */
export async function exportDrawingPdf(opts: ExportOptions): Promise<void> {
  const { pdf } = await buildDrawingPdf(opts);
  pdf.save(exportFilename(exportBaseName(opts), opts.date, "pdf"));
}

/** Draw a titled table; returns the Y just below it, adding pages as needed. */
function drawTable(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdf: any,
  title: string,
  headers: string[],
  colFracs: number[],
  rows: string[][],
  emptyNote: string,
  x: number,
  startY: number,
  contentW: number,
  pageH: number,
  margin: number
): number {
  let y = startY;
  const colX = colFracs.map(
    (_, i) => x + contentW * colFracs.slice(0, i).reduce((a, b) => a + b, 0)
  );

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.setTextColor(0, 46, 129);
  pdf.text(title, x, y);
  y += 16;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(7);
  pdf.setTextColor(120, 120, 120);
  headers.forEach((hdr, i) => pdf.text(hdr, colX[i], y));
  y += 5;
  pdf.setDrawColor(210, 210, 210);
  pdf.setLineWidth(0.5);
  pdf.line(x, y, x + contentW, y);
  y += 12;

  if (rows.length === 0) {
    pdf.setFont("helvetica", "italic");
    pdf.setFontSize(9);
    pdf.setTextColor(150, 150, 150);
    pdf.text(emptyNote, x, y);
    return y + 16;
  }

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8.5);
  pdf.setTextColor(30, 30, 30);
  for (const row of rows) {
    if (y > pageH - margin) {
      pdf.addPage();
      y = margin + 10;
    }
    row.forEach((cell, i) => pdf.text(clip(cell ?? "—", 30), colX[i], y));
    y += 13;
  }
  return y + 8;
}

/** One-click bid package: the drawing PAGE 1, then a summary PAGE 2 with the
 *  change ledger (what changed) and the configured-dimensions table. */
export async function exportBidPackage(opts: ExportOptions): Promise<void> {
  const { pdf, pageW, pageH, margin, tb } = await buildDrawingPdf(opts);
  const components = opts.components ?? {};
  const originals = opts.originals ?? {};

  pdf.addPage();
  let y = drawPdfHeader(pdf, tb, pageW, margin);
  const contentW = pageW - margin * 2;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.setTextColor(20, 20, 20);
  pdf.text("Configuration Summary", margin, y);
  y += 22;

  const ledger = buildChangeLedger(originals, components);
  y = drawTable(
    pdf,
    `Changes from base design (${ledger.length})`,
    ["COMPONENT", "DIMENSION", "WAS", "NOW", "CHANGE"],
    [0.3, 0.16, 0.18, 0.18, 0.18],
    ledger.map((r) => [
      r.componentName,
      r.dimKey,
      r.oldValue,
      r.newValue,
      `${r.deltaInches > 0 ? "+" : ""}${Math.round(r.pctChange)}%`,
    ]),
    "No changes from the base design.",
    margin,
    y,
    contentW,
    pageH,
    margin
  );

  const dims = buildDimensionsTable(components);
  y = drawTable(
    pdf,
    "Configured dimensions",
    ["COMPONENT", "TYPE", "HEIGHT", "WIDTH"],
    [0.34, 0.2, 0.23, 0.23],
    dims.map((d) => [d.name, d.type, d.height ?? "—", d.width ?? "—"]),
    "No dimensioned components.",
    margin,
    y + 6,
    contentW,
    pageH,
    margin
  );

  pdf.save(exportFilename(`${exportBaseName(opts)}-bid`, opts.date, "pdf"));
}
