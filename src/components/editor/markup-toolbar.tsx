"use client";

/**
 * Floating tool-select cluster for the red markup layer (pan / select / line /
 * arrow / text). Mirrors the visual idiom of the zoom-button cluster in
 * svg-drawing-canvas.tsx (rounded-lg white card, border, shadow-sm, 32px
 * square buttons) but lives in its own file to keep the 1750+ line canvas
 * from growing further. Purely a store-driven control surface — it does not
 * touch drawing/zoom/pan state itself; `MarkupOverlay` reacts to the
 * `markupTool` value this sets.
 */

import { Hand, MousePointer2, Minus, ArrowUpRight, Type, Trash2 } from "lucide-react";
import { useEditorStore, type EditorState } from "@/stores/editor-store";

type MarkupTool = EditorState["markupTool"];

const TOOLS: { id: MarkupTool; label: string; Icon: typeof Hand }[] = [
  { id: "pan", label: "Pan", Icon: Hand },
  { id: "select", label: "Select", Icon: MousePointer2 },
  { id: "line", label: "Line", Icon: Minus },
  { id: "arrow", label: "Arrow", Icon: ArrowUpRight },
  { id: "text", label: "Text", Icon: Type },
];

export function MarkupToolbar() {
  const markupTool = useEditorStore((s) => s.markupTool);
  const setMarkupTool = useEditorStore((s) => s.setMarkupTool);
  const selectedMarkupId = useEditorStore((s) => s.selectedMarkupId);
  const deleteMarkup = useEditorStore((s) => s.deleteMarkup);

  return (
    <div className="absolute top-3 right-3 z-20 flex flex-col items-end gap-1.5">
      <div
        className="rounded-lg bg-white/95 border border-gray-200 shadow-sm
                   px-1.5 pt-1 pb-1.5 flex flex-col items-stretch gap-1"
      >
        <div className="text-[9px] font-bold tracking-wide text-gray-400 uppercase px-0.5">
          Markup
        </div>
        <div className="flex gap-1">
          {TOOLS.map(({ id, label, Icon }) => {
            const isActive = markupTool === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setMarkupTool(id)}
                title={label}
                aria-label={label}
                aria-pressed={isActive}
                className={`w-[32px] h-[32px] rounded-lg border flex items-center justify-center
                            transition-all
                            ${
                              isActive
                                ? "bg-red-600 border-red-600 text-white shadow-sm"
                                : "bg-white border-gray-200 text-gray-500 hover:bg-white hover:text-gray-800 hover:border-gray-300"
                            }`}
              >
                <Icon size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </div>

      {selectedMarkupId && (
        <button
          type="button"
          onClick={() => deleteMarkup(selectedMarkupId)}
          title="Delete markup"
          aria-label="Delete markup"
          className="w-[32px] h-[32px] rounded-lg bg-white/95 border border-red-200
                     text-red-500 flex items-center justify-center shadow-sm
                     hover:bg-red-50 hover:border-red-300 transition-all"
        >
          <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
