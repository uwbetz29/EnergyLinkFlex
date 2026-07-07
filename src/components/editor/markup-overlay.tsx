"use client";

/**
 * Interactive red-markup drawing layer (line / arrow / text annotations) laid
 * over a DWG sheet. Mounted as a transparent, viewBox-matched <svg> SIBLING
 * INSIDE the same zoom/pan-transformed wrapper div that hosts the drawing svg
 * (see svg-drawing-canvas.tsx) — it therefore INHERITS that div's translate +
 * pixel-size transform for free and stays pinned through pan/zoom. This
 * component intentionally never reads `zoom`/`panX`/`panY` from the store;
 * screen <-> drawing conversion goes through this svg's own `getScreenCTM()`
 * so there is exactly one transform path (the browser's), not a duplicated,
 * drift-prone one.
 *
 * Coordinates for stored markups are this overlay svg's viewBox units (NOT
 * Model_Space — no Y-flip here; getScreenCTM() already accounts for the
 * viewBox). Geometry (hit-test / move / arrowhead / drag-normalize) is pure
 * and lives in `lib/dwg/markup-geometry.ts`; this component only wires
 * pointer events + rendering to it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useEditorStore } from "@/stores/editor-store";
import type { Markup } from "@/lib/dwg/types";
import {
  hitTest,
  moveMarkup,
  arrowGeometry,
  normalizeDrag,
  TEXT_CHAR_W,
  type Pt,
} from "@/lib/dwg/markup-geometry";

/* ─── Constants ─── */
const RED = "#e11d2a";
const SELECTED_BLUE = "#2563eb";
const HIT_TOL = 6; // viewBox units
const DRAG_MIN = 4; // viewBox units — below this, a line/arrow drag is a no-op click
const ARROW_HEAD_LEN = 14;
const ARROW_HEAD_WIDTH = 12;
/** Matches the ~16px annotation glyph markup-geometry.ts's TEXT_CHAR_W/cap-height
 *  assumptions are built around, so the rendered glyph roughly fills its hit-test bbox. */
const TEXT_FONT_SIZE = 16;
const HALO_PAD = 4;

interface MarkupOverlayProps {
  viewBox: string;
  sheetNumber: number;
}

/** In-progress line/arrow drag, not yet committed to the store. */
interface DraftSeg {
  start: Pt;
  end: Pt;
}

/** In-progress inline text edit — a brand-new markup (editingId null) or an
 *  edit of an existing one (editingId set). */
interface TextDraft {
  x: number;
  y: number;
  value: string;
  editingId: string | null;
}

function newId(sheetNumber: number, count: number): string {
  return `mk_${sheetNumber}_${count}_${Math.round(performance.now())}`;
}

/** The coordinate fields that change when a markup is translated, keyed by
 *  type — used to build the `updateMarkup` patch after a drag-move. */
function coordPatch(m: Markup): Partial<Markup> {
  switch (m.type) {
    case "line":
    case "arrow":
      return { x1: m.x1, y1: m.y1, x2: m.x2, y2: m.y2 };
    case "text":
      return { x: m.x, y: m.y };
  }
}

export function MarkupOverlay({ viewBox, sheetNumber }: MarkupOverlayProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  /** Active "drag an already-selected markup" tracking (Select tool only). */
  const dragMoveRef = useRef<{ id: string; last: Pt } | null>(null);

  const [draft, setDraft] = useState<DraftSeg | null>(null);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  /** Local CSS-pixel position of the text-edit <input>, derived from
   *  textDraft's anchor via toLocalPx. Computed in an effect (not read
   *  from the ref during render) and keyed on the anchor coords only, so
   *  typing (which only changes `value`) doesn't re-derive it. */
  const [inputPos, setInputPos] = useState<Pt | null>(null);

  const {
    markups,
    selectedMarkupId,
    markupTool,
    addMarkup,
    updateMarkup,
    deleteMarkup,
    selectMarkup,
    setMarkupTool,
  } = useEditorStore();

  const sheetMarkups = markups.filter((m) => m.sheetNumber === sheetNumber);
  const active = markupTool !== "pan";

  /** Screen point -> this svg's viewBox point, via its own live CTM. */
  const toDrawing = useCallback((e: { clientX: number; clientY: number }): Pt => {
    const svg = svgRef.current!;
    const p = svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const d = p.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: d.x, y: d.y };
  }, []);

  /**
   * viewBox point -> local CSS-pixel offset within this svg's own box, for
   * positioning the plain-HTML text-edit <input> (which lives in ordinary,
   * unscaled CSS pixel space, not viewBox space — a foreignObject would be
   * mis-scaled by the drawing's often-huge viewBox units).
   *
   * This works with a *pure* screen-space delta (getScreenCTM() point minus
   * getBoundingClientRect() top-left, both already post-transform) only
   * because the ancestor wrapper div's transform is translate-only (baked-in
   * zoom sizes the box in pixels; there is no CSS scale()) — a translation
   * preserves deltas, so the screen-space delta equals the local,
   * pre-transform pixel delta the CSS `left`/`top` below expect.
   */
  const toLocalPx = useCallback((pt: Pt): Pt => {
    const svg = svgRef.current!;
    const p = svg.createSVGPoint();
    p.x = pt.x;
    p.y = pt.y;
    const screen = p.matrixTransform(svg.getScreenCTM()!);
    const rect = svg.getBoundingClientRect();
    return { x: screen.x - rect.left, y: screen.y - rect.top };
  }, []);

  /* ─── Position the text-edit <input> (ref read belongs in an effect, not render) ─── */
  useEffect(() => {
    if (!textDraft) {
      setInputPos(null);
      return;
    }
    setInputPos(toLocalPx({ x: textDraft.x, y: textDraft.y }));
    // Only the anchor coords matter here — `value` (typing) intentionally excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textDraft?.x, textDraft?.y, toLocalPx]);

  /* ─── Delete/Backspace removes the selected markup (global, any tool) ─── */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      // Don't hijack Delete/Backspace while the user is typing (text editor,
      // or any other focused input/textarea elsewhere in the app).
      const tag = (document.activeElement?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      const id = useEditorStore.getState().selectedMarkupId;
      if (!id) return;
      e.preventDefault();
      deleteMarkup(id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteMarkup]);

  /* ─── Commit (Enter/blur) or cancel (Escape) the inline text editor ─── */
  // NOTE: mutations run in the (event-driven) callback body, NOT inside a
  // setState updater — updater fns must be pure, and React StrictMode double-
  // invokes them in dev, which would create every text markup twice.
  const commitTextDraft = useCallback(() => {
    const d = textDraft;
    if (!d) return;
    const value = d.value.trim();
    if (value) {
      if (d.editingId) {
        updateMarkup(d.editingId, { text: value } as Partial<Markup>);
      } else {
        addMarkup({
          id: newId(sheetNumber, useEditorStore.getState().markups.length),
          sheetNumber,
          type: "text",
          x: d.x,
          y: d.y,
          text: value,
        });
      }
    }
    // Empty text is discarded either way (new markup: never created;
    // existing markup: edit dropped, original text kept).
    if (!d.editingId) setMarkupTool("select");
    setTextDraft(null);
  }, [textDraft, addMarkup, updateMarkup, setMarkupTool, sheetNumber]);

  const cancelTextDraft = useCallback(() => {
    if (textDraft && !textDraft.editingId) setMarkupTool("select");
    setTextDraft(null);
  }, [textDraft, setMarkupTool]);

  /* ─── Pointer handlers on the overlay svg ─── */
  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!active) return; // pan mode: pass-through, canvas pan handles it
    const pt = toDrawing(e);

    if (markupTool === "line" || markupTool === "arrow") {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDraft({ start: pt, end: pt });
      return;
    }

    if (markupTool === "text") {
      setTextDraft({ x: pt.x, y: pt.y, value: "", editingId: null });
      return;
    }

    // Select tool
    const id = hitTest(sheetMarkups, pt, HIT_TOL);
    selectMarkup(id);
    if (id) {
      e.currentTarget.setPointerCapture(e.pointerId);
      dragMoveRef.current = { id, last: pt };
    }
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (draft) {
      const pt = toDrawing(e);
      setDraft((d) => (d ? { ...d, end: pt } : d));
      return;
    }
    if (dragMoveRef.current) {
      const pt = toDrawing(e);
      const { id, last } = dragMoveRef.current;
      const dx = pt.x - last.x;
      const dy = pt.y - last.y;
      if (dx === 0 && dy === 0) return;
      const current = useEditorStore.getState().markups.find((m) => m.id === id);
      if (current) {
        updateMarkup(id, coordPatch(moveMarkup(current, dx, dy)));
      }
      dragMoveRef.current = { id, last: pt };
    }
  };

  const handlePointerUp = () => {
    if (draft) {
      const seg = normalizeDrag(draft.start, draft.end, DRAG_MIN);
      if (seg && (markupTool === "line" || markupTool === "arrow")) {
        addMarkup({
          id: newId(sheetNumber, markups.length),
          sheetNumber,
          type: markupTool,
          ...seg,
        });
        setMarkupTool("select");
      }
      setDraft(null);
    }
    dragMoveRef.current = null;
  };

  return (
    <>
      <svg
        ref={svgRef}
        viewBox={viewBox}
        className="absolute inset-0"
        style={{
          width: "100%",
          height: "100%",
          // MUST stay transparent: the drawing SVG injects a document-wide
          // `svg { background: white }` rule (inline-SVG <style> is not scoped),
          // which would otherwise paint this overlay white ON TOP of the
          // drawing and hide it entirely.
          background: "transparent",
          pointerEvents: active ? "auto" : "none",
          cursor: active ? "crosshair" : undefined,
        }}
        // Quarantine our interactions from the canvas's own pan-arm (onMouseDown)
        // and component-deselect (onClick) handlers, which live on an ancestor
        // and would otherwise also fire for every markup click/drag.
        onMouseDown={(e) => {
          if (active) e.stopPropagation();
        }}
        onClick={(e) => {
          if (active) e.stopPropagation();
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {sheetMarkups.map((m) => {
          const isSelected = m.id === selectedMarkupId;

          if (m.type === "text") {
            const haloW = m.text.length * TEXT_CHAR_W + HALO_PAD * 2;
            return (
              <g key={m.id}>
                {isSelected && (
                  <rect
                    x={m.x - HALO_PAD}
                    y={m.y - TEXT_FONT_SIZE - HALO_PAD}
                    width={haloW}
                    height={TEXT_FONT_SIZE + HALO_PAD * 2}
                    rx={2}
                    fill="none"
                    stroke={SELECTED_BLUE}
                    strokeWidth={1.5}
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                <text
                  x={m.x}
                  y={m.y}
                  fill={RED}
                  fontSize={TEXT_FONT_SIZE}
                  style={{ userSelect: "none" }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (markupTool !== "select") return;
                    selectMarkup(m.id);
                    setTextDraft({ x: m.x, y: m.y, value: m.text, editingId: m.id });
                  }}
                >
                  {m.text}
                </text>
              </g>
            );
          }

          const headPts = arrowGeometry(m.x1, m.y1, m.x2, m.y2, ARROW_HEAD_LEN, ARROW_HEAD_WIDTH);
          return (
            <g key={m.id}>
              {isSelected && (
                <line
                  x1={m.x1}
                  y1={m.y1}
                  x2={m.x2}
                  y2={m.y2}
                  stroke={SELECTED_BLUE}
                  strokeWidth={7}
                  strokeLinecap="round"
                  opacity={0.35}
                  vectorEffect="non-scaling-stroke"
                />
              )}
              <line
                x1={m.x1}
                y1={m.y1}
                x2={m.x2}
                y2={m.y2}
                stroke={RED}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
              {m.type === "arrow" && (
                <polygon
                  points={`${m.x2},${m.y2} ${headPts[0].x},${headPts[0].y} ${headPts[1].x},${headPts[1].y}`}
                  fill={RED}
                  stroke={RED}
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </g>
          );
        })}

        {/* Live rubber-band preview while dragging out a new line/arrow */}
        {draft && (markupTool === "line" || markupTool === "arrow") && (
          <g style={{ pointerEvents: "none" }}>
            <line
              x1={draft.start.x}
              y1={draft.start.y}
              x2={draft.end.x}
              y2={draft.end.y}
              stroke={RED}
              strokeWidth={2}
              strokeDasharray="6 4"
              vectorEffect="non-scaling-stroke"
            />
            {markupTool === "arrow" &&
              (() => {
                const pts = arrowGeometry(
                  draft.start.x,
                  draft.start.y,
                  draft.end.x,
                  draft.end.y,
                  ARROW_HEAD_LEN,
                  ARROW_HEAD_WIDTH
                );
                return (
                  <polygon
                    points={`${draft.end.x},${draft.end.y} ${pts[0].x},${pts[0].y} ${pts[1].x},${pts[1].y}`}
                    fill={RED}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })()}
          </g>
        )}
      </svg>

      {/* Inline text editor: a plain HTML <input>, positioned in local CSS
          pixels (see toLocalPx/inputPos) rather than SVG-native so it
          doesn't get mis-scaled by the drawing's viewBox units. */}
      {textDraft && inputPos && (
        <input
          autoFocus
          value={textDraft.value}
          onChange={(e) =>
            setTextDraft((d) => (d ? { ...d, value: e.target.value } : d))
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitTextDraft();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancelTextDraft();
            }
          }}
          onBlur={commitTextDraft}
          className="absolute rounded-md border-2 bg-white px-1.5 py-0.5 text-[13px]
                     font-medium outline-none shadow-md"
          style={{
            left: inputPos.x,
            top: inputPos.y - 20,
            minWidth: 120,
            color: RED,
            borderColor: RED,
            zIndex: 20,
          }}
        />
      )}
    </>
  );
}
