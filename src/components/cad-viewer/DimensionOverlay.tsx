"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useCADStore } from "@/lib/cad/store";
import { CADRenderer } from "@/lib/cad/renderer";
import { formatImperialDimension } from "@/lib/cad/dimension-link";
import { previewDimension } from "@/lib/cad/dimension-modify";
import { isDimensionLinked } from "@/lib/cad/cross-page-propagate";
import type { ParametricDimension, Point2D, CascadeSuggestion } from "@/types/cad";

// --- Imperial Dimension Input Helpers ---

const FRACTIONS = [
  { label: "--", value: 0 },
  { label: "1/16", value: 1 / 16 },
  { label: "1/8", value: 1 / 8 },
  { label: "3/16", value: 3 / 16 },
  { label: "1/4", value: 1 / 4 },
  { label: "5/16", value: 5 / 16 },
  { label: "3/8", value: 3 / 8 },
  { label: "7/16", value: 7 / 16 },
  { label: "1/2", value: 1 / 2 },
  { label: "9/16", value: 9 / 16 },
  { label: "5/8", value: 5 / 8 },
  { label: "11/16", value: 11 / 16 },
  { label: "3/4", value: 3 / 4 },
  { label: "13/16", value: 13 / 16 },
  { label: "7/8", value: 7 / 8 },
  { label: "15/16", value: 15 / 16 },
] as const;

/** Decompose total inches into feet, whole inches, and nearest 1/16 fraction index */
function decomposeImperial(totalInches: number): {
  feet: number;
  inches: number;
  fractionIdx: number;
} {
  const feet = Math.floor(totalInches / 12);
  const remaining = totalInches - feet * 12;
  let wholeInches = Math.floor(remaining);
  const fractional = remaining - wholeInches;

  // Find nearest 1/16th fraction
  let bestIdx = 0;
  let bestErr = Math.abs(fractional);
  for (let i = 1; i < FRACTIONS.length; i++) {
    const err = Math.abs(fractional - FRACTIONS[i].value);
    if (err < bestErr) {
      bestErr = err;
      bestIdx = i;
    }
  }

  // Handle rounding to next whole inch (e.g., fractional ≈ 1.0)
  if (bestIdx === 0 && fractional > 0.97) {
    wholeInches += 1;
  }

  return { feet, inches: wholeInches, fractionIdx: bestIdx };
}

/** Compose feet, inches, and fraction index back to total inches */
function composeImperial(
  feet: number,
  inches: number,
  fractionIdx: number
): number {
  return feet * 12 + inches + FRACTIONS[fractionIdx].value;
}

// --- Cascade Suggestion Row ---

function CascadeRow({
  suggestion,
  onApply,
  onSkip,
}: {
  suggestion: CascadeSuggestion;
  onApply: () => void;
  onSkip: () => void;
}) {
  const confidenceColor =
    suggestion.confidence === "high"
      ? "bg-[#93C90F]"
      : suggestion.confidence === "medium"
        ? "bg-amber-400"
        : "bg-[#D4D4D4]";

  const arrow =
    suggestion.action === "shift"
      ? suggestion.displacement && Math.abs(suggestion.displacement.y) > Math.abs(suggestion.displacement.x)
        ? suggestion.displacement.y > 0 ? "\u25B2" : "\u25BC"
        : suggestion.displacement && suggestion.displacement.x > 0 ? "\u25B6" : "\u25C0"
      : "\u2194";

  return (
    <div className="flex items-center gap-1 text-[10px]">
      <span className="w-3 text-center text-[#666]">{arrow}</span>
      <span className="font-mono text-[#333] truncate flex-1" title={suggestion.reason}>
        {suggestion.displayText}
      </span>
      <span className="text-[#999] truncate max-w-[80px]">{suggestion.reason}</span>
      <span className={`w-1.5 h-1.5 rounded-full ${confidenceColor} flex-shrink-0`} />
      <button
        onClick={onApply}
        className="px-1.5 py-0.5 rounded bg-[#93C90F] text-white font-medium hover:bg-[#7AB00D] transition-colors flex-shrink-0"
      >
        Apply
      </button>
      <button
        onClick={onSkip}
        className="px-1.5 py-0.5 rounded bg-[#F0F0F0] text-[#999] border border-[#D4D4D4] font-medium hover:bg-[#E0E0E0] transition-colors flex-shrink-0"
      >
        Skip
      </button>
    </div>
  );
}

// --- Component ---

interface DimensionOverlayProps {
  renderer: CADRenderer | null;
}

interface ScreenDimension {
  dim: ParametricDimension;
  screenPos: Point2D;
}

export function DimensionOverlay({ renderer }: DimensionOverlayProps) {
  const {
    drawing,
    dimensions,
    selectedDimensionId,
    selectDimension,
    applyAIDimensionChange,
    applyDimensionChangeWithPropagation,
    compositeAnalysis,
    pdfCurrentPage,
    isResizing,
    resizeError,
    lastResizeReasoning,
    clearResizeError,
    cascadeSuggestions,
    applyCascadeSuggestion,
    applyCascadeAll,
    applyCascadeHighConfidence,
    dismissCascade,
    componentGraph,
    constraintViolations,
  } = useCADStore();

  const [screenDims, setScreenDims] = useState<ScreenDimension[]>([]);
  const [editMode, setEditMode] = useState<"value" | "percent">("value");
  const [editError, setEditError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [userInstruction, setUserInstruction] = useState("");
  const [pivotSide, setPivotSide] = useState<"auto" | "anchor0" | "anchor1">("auto");

  // Imperial structured input (value mode)
  const [editFeet, setEditFeet] = useState("0");
  const [editInches, setEditInches] = useState("0");
  const [editFractionIdx, setEditFractionIdx] = useState(0);

  // Percent input (percent mode)
  const [editPercent, setEditPercent] = useState("100");

  const feetInputRef = useRef<HTMLInputElement>(null);
  const percentInputRef = useRef<HTMLInputElement>(null);

  // Update screen positions when camera moves
  const updatePositions = useCallback(() => {
    if (!renderer || !drawing || dimensions.length === 0) {
      setScreenDims([]);
      return;
    }

    const visible: ScreenDimension[] = [];
    for (const dim of dimensions) {
      // Hide very low confidence dimensions entirely (junk/title block)
      if (dim.confidence < 0.05) continue;

      const entity = drawing.entities.find((e) => e.handle === dim.textHandle);
      const worldPos = entity?.insertionPoint || {
        x: (dim.anchorPoints[0].x + dim.anchorPoints[1].x) / 2,
        y: (dim.anchorPoints[0].y + dim.anchorPoints[1].y) / 2,
      };

      const screen = renderer.worldToScreen(worldPos.x, worldPos.y);
      if (screen) {
        visible.push({ dim, screenPos: screen });
      }
    }
    setScreenDims(visible);
  }, [renderer, drawing, dimensions]);

  // Listen for view changes (zoom/pan)
  useEffect(() => {
    if (!renderer) return;
    renderer.onViewChange(updatePositions);
    updatePositions();
    return () => {
      renderer.removeViewChangeCallback(updatePositions);
    };
  }, [renderer, updatePositions]);

  // Also update when drawing/dimensions change
  useEffect(() => {
    updatePositions();
  }, [drawing, dimensions, updatePositions]);

  // Focus input when a dimension is selected
  useEffect(() => {
    if (selectedDimensionId) {
      if (editMode === "value" && feetInputRef.current) {
        feetInputRef.current.focus();
        feetInputRef.current.select();
      } else if (editMode === "percent" && percentInputRef.current) {
        percentInputRef.current.focus();
        percentInputRef.current.select();
      }
    }
  }, [selectedDimensionId, editMode]);

  // Debounced preview: show ghost overlay as user types
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!renderer || !drawing || !selectedDimensionId || isResizing || applied) {
      renderer?.clearPreview();
      return;
    }

    // Clear previous timer
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);

    previewTimerRef.current = setTimeout(() => {
      try {
        let previewParams;
        if (editMode === "percent") {
          const pct = parseFloat(editPercent);
          if (!pct || pct <= 0 || Math.abs(pct - 100) < 0.01) {
            renderer.clearPreview();
            return;
          }
          previewParams = { dimensionId: selectedDimensionId, scalePercent: pct, pivotSide };
        } else {
          const ft = parseInt(editFeet) || 0;
          const inches = parseInt(editInches) || 0;
          const newVal = composeImperial(ft, inches, editFractionIdx);
          if (newVal <= 0) {
            renderer.clearPreview();
            return;
          }
          // Check if value actually changed
          const dim = dimensions.find(d => d.id === selectedDimensionId);
          if (dim && Math.abs(newVal - dim.value) < 0.001) {
            renderer.clearPreview();
            return;
          }
          previewParams = { dimensionId: selectedDimensionId, newValue: newVal, pivotSide };
        }

        const result = previewDimension(drawing, dimensions, previewParams);
        if (result && result.affectedHandles.length > 0) {
          renderer.showPreview(result.previewEntities, result.affectedHandles);
        } else {
          renderer.clearPreview();
        }
      } catch {
        renderer.clearPreview();
      }
    }, 300);

    return () => {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    };
  }, [editFeet, editInches, editFractionIdx, editPercent, editMode, selectedDimensionId, pivotSide, drawing, dimensions, renderer, isResizing, applied]);

  // Clear preview when popup closes
  useEffect(() => {
    if (!selectedDimensionId) {
      renderer?.clearPreview();
    }
  }, [selectedDimensionId, renderer]);

  const handleDimClick = useCallback(
    (dimId: string) => {
      const dim = dimensions.find((d) => d.id === dimId);
      if (!dim) return;
      selectDimension(dimId);

      // Decompose the current value into feet/inches/fraction
      const parts = decomposeImperial(dim.value);
      setEditFeet(String(parts.feet));
      setEditInches(String(parts.inches));
      setEditFractionIdx(parts.fractionIdx);
      setEditPercent("100");

      setEditMode("value");
      setEditError(null);
      setApplied(false);
      setUserInstruction("");
      setPivotSide("auto");
      clearResizeError();
    },
    [dimensions, selectDimension, clearResizeError]
  );

  const handleApply = useCallback(async () => {
    if (!selectedDimensionId || isResizing) return;
    setEditError(null);
    renderer?.clearPreview();

    // Choose whether to use propagation (composite) or plain AI resize
    const applyFn = compositeAnalysis
      ? applyDimensionChangeWithPropagation
      : applyAIDimensionChange;

    try {
      if (editMode === "percent") {
        const pct = parseFloat(editPercent);
        if (isNaN(pct) || pct <= 0) {
          setEditError("Enter a positive number (e.g. 110 for 110%)");
          return;
        }
        await applyFn({
          dimensionId: selectedDimensionId,
          scalePercent: pct,
          userInstruction: userInstruction || undefined,
          pivotSide,
        });
      } else {
        const ft = parseInt(editFeet) || 0;
        const inches = parseInt(editInches) || 0;
        const newVal = composeImperial(ft, inches, editFractionIdx);
        if (newVal <= 0) {
          setEditError("Dimension must be a positive value");
          return;
        }
        await applyFn({
          dimensionId: selectedDimensionId,
          newValue: newVal,
          userInstruction: userInstruction || undefined,
          pivotSide,
        });
      }

      // Check if the store caught an error
      const currentError = useCADStore.getState().error;
      if (currentError) {
        setEditError(currentError);
        return;
      }

      // Show brief success flash
      setApplied(true);

      // Auto-close after delay UNLESS cascade suggestions are pending
      setTimeout(() => {
        const { cascadeSuggestions: currentCascade } = useCADStore.getState();
        if (currentCascade.length === 0) {
          setApplied(false);
          selectDimension(null);
        }
      }, 1500);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to apply change");
    }
  }, [selectedDimensionId, editFeet, editInches, editFractionIdx, editPercent, editMode, userInstruction, pivotSide, isResizing, applyAIDimensionChange, applyDimensionChangeWithPropagation, compositeAnalysis, selectDimension, renderer]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        handleApply();
      } else if (e.key === "Escape") {
        selectDimension(null);
      }
    },
    [handleApply, selectDimension]
  );

  /** Compute the current new value for display purposes */
  const computeNewValue = useCallback(() => {
    if (editMode === "percent") {
      const selectedDim = dimensions.find((d) => d.id === selectedDimensionId);
      if (!selectedDim) return null;
      const pct = parseFloat(editPercent) || 100;
      return selectedDim.value * pct / 100;
    }
    const ft = parseInt(editFeet) || 0;
    const inches = parseInt(editInches) || 0;
    return composeImperial(ft, inches, editFractionIdx);
  }, [editMode, editPercent, editFeet, editInches, editFractionIdx, selectedDimensionId, dimensions]);

  const selectedDim = dimensions.find((d) => d.id === selectedDimensionId);

  if (!drawing || dimensions.length === 0) return null;

  return (
    <>
      {/* Clickable dimension labels */}
      {screenDims.map(({ dim, screenPos }) => {
        const isSelected = dim.id === selectedDimensionId;
        const isLowConfidence = dim.confidence < 0.3;
        const currentPageSource = `pdf:${pdfCurrentPage}`;
        const isLinked = isDimensionLinked(dim.id, currentPageSource, compositeAnalysis);
        return (
          <button
            key={dim.id}
            className={`absolute z-20 px-1.5 py-0.5 text-xs font-mono rounded border cursor-pointer
              transition-all duration-150 whitespace-nowrap select-none
              ${isSelected
                ? "bg-[#93C90F] text-white border-[#7AB00D] shadow-lg scale-110 ring-2 ring-[#93C90F]/30"
                : isLowConfidence
                  ? "bg-yellow-100 text-yellow-800 border-yellow-400 hover:bg-yellow-200"
                  : isLinked
                    ? "bg-blue-100 text-[#0C121D] border-blue-400 hover:bg-blue-200 hover:border-blue-500"
                    : "bg-white text-[#0C121D] border-[#BBBBBB] hover:bg-[#F0F0F0] hover:border-[#93C90F]"
              }`}
            style={{
              left: screenPos.x,
              top: screenPos.y,
              transform: "translate(-50%, -100%)",
              pointerEvents: "auto",
              opacity: dim.confidence < 0.15 ? 0.4 : 1,
            }}
            onClick={(e) => {
              e.stopPropagation();
              handleDimClick(dim.id);
            }}
            title={`${dim.displayText} (${dim.direction}${isLinked ? ", linked across pages" : ""}, confidence: ${Math.round(dim.confidence * 100)}%)`}
          >
            {isLinked && <span className="mr-0.5">🔗</span>}
            {dim.displayText}
          </button>
        );
      })}

      {/* Edit popup */}
      {selectedDim && (() => {
        const screenDim = screenDims.find((s) => s.dim.id === selectedDim.id);
        if (!screenDim) return null;
        const newVal = computeNewValue();
        const isDiameter = selectedDim.direction === "diameter";
        const viewportH = typeof window !== "undefined" ? window.innerHeight : 800;
        const viewportW = typeof window !== "undefined" ? window.innerWidth : 1000;
        const popupH = cascadeSuggestions.length > 0 ? 520 : 380; // estimated popup height
        const flipUp = screenDim.screenPos.y + popupH > viewportH;
        return (
          <div
            className="absolute z-30 bg-white rounded-lg shadow-xl border border-[#D4D4D4] p-3 w-80"
            style={{
              left: Math.max(160, Math.min(screenDim.screenPos.x, viewportW - 160)),
              top: Math.max(8, flipUp ? screenDim.screenPos.y - popupH - 8 : screenDim.screenPos.y + 8),
              transform: "translateX(-50%)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-xs text-[#999] mb-1.5 font-medium">
              Edit Dimension {isDiameter && <span className="text-[#93C90F]">(Diameter)</span>}
              {componentGraph && (() => {
                const comp = componentGraph.components.find(c => c.dimensionIds.includes(selectedDim.id));
                return comp ? (
                  <span className="ml-1.5 text-[#00BFDD]">
                    — {comp.label}
                  </span>
                ) : null;
              })()}
            </div>

            {/* Mode toggle */}
            <div className="flex gap-1 mb-2">
              <button
                className={`flex-1 text-xs py-1 px-2 rounded border transition-colors
                  ${editMode === "value"
                    ? "bg-[#93C90F] text-white border-[#7AB00D]"
                    : "bg-[#F0F0F0] text-[#666] border-[#D4D4D4] hover:bg-[#E0E0E0]"
                  }`}
                onClick={() => {
                  setEditMode("value");
                  const parts = decomposeImperial(selectedDim.value);
                  setEditFeet(String(parts.feet));
                  setEditInches(String(parts.inches));
                  setEditFractionIdx(parts.fractionIdx);
                  setEditError(null);
                }}
                disabled={isResizing}
              >
                Feet / Inches
              </button>
              <button
                className={`flex-1 text-xs py-1 px-2 rounded border transition-colors
                  ${editMode === "percent"
                    ? "bg-[#93C90F] text-white border-[#7AB00D]"
                    : "bg-[#F0F0F0] text-[#666] border-[#D4D4D4] hover:bg-[#E0E0E0]"
                  }`}
                onClick={() => {
                  setEditMode("percent");
                  setEditPercent("100");
                  setEditError(null);
                }}
                disabled={isResizing}
              >
                % Scale
              </button>
            </div>

            {/* Pivot toggle */}
            <div className="flex gap-1 mb-2">
              {(["auto", "anchor0", "anchor1"] as const).map((side) => {
                const label = side === "auto" ? "Auto Pivot"
                  : side === "anchor0" ? "Fix Start" : "Fix End";
                return (
                  <button
                    key={side}
                    className={`flex-1 text-[10px] py-0.5 px-1.5 rounded border transition-colors
                      ${pivotSide === side
                        ? "bg-[#00BFDD]/20 text-[#007A8F] border-[#00BFDD]"
                        : "bg-[#F0F0F0] text-[#999] border-[#D4D4D4] hover:bg-[#E0E0E0]"
                      }`}
                    onClick={() => setPivotSide(side)}
                    disabled={isResizing}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Input fields */}
            {editMode === "value" ? (
              <div className="flex items-center gap-1">
                {/* Feet */}
                <input
                  ref={feetInputRef}
                  type="number"
                  min={0}
                  value={editFeet}
                  onChange={(e) => { setEditFeet(e.target.value); setEditError(null); }}
                  onKeyDown={handleKeyDown}
                  onFocus={(e) => e.target.select()}
                  disabled={isResizing}
                  className={`w-14 px-1.5 py-1.5 text-sm text-center border rounded font-mono
                    focus:outline-none focus:ring-1
                    ${editError
                      ? "border-red-400 focus:border-red-500 focus:ring-red-300/30"
                      : applied
                        ? "border-[#93C90F] bg-[#93C90F]/5"
                        : "border-[#D4D4D4] focus:border-[#93C90F] focus:ring-[#93C90F]/30"
                    }`}
                />
                <span className="text-sm text-[#666] font-mono">&apos;</span>

                {/* Inches */}
                <input
                  type="number"
                  min={0}
                  max={11}
                  value={editInches}
                  onChange={(e) => { setEditInches(e.target.value); setEditError(null); }}
                  onKeyDown={handleKeyDown}
                  onFocus={(e) => e.target.select()}
                  disabled={isResizing}
                  className={`w-12 px-1.5 py-1.5 text-sm text-center border rounded font-mono
                    focus:outline-none focus:ring-1
                    ${editError
                      ? "border-red-400 focus:border-red-500 focus:ring-red-300/30"
                      : applied
                        ? "border-[#93C90F] bg-[#93C90F]/5"
                        : "border-[#D4D4D4] focus:border-[#93C90F] focus:ring-[#93C90F]/30"
                    }`}
                />

                {/* Fraction */}
                <select
                  value={editFractionIdx}
                  onChange={(e) => { setEditFractionIdx(Number(e.target.value)); setEditError(null); }}
                  onKeyDown={handleKeyDown}
                  disabled={isResizing}
                  className={`w-[68px] px-1 py-1.5 text-sm border rounded font-mono
                    focus:outline-none focus:ring-1 appearance-none bg-white cursor-pointer
                    ${editError
                      ? "border-red-400"
                      : applied
                        ? "border-[#93C90F] bg-[#93C90F]/5"
                        : "border-[#D4D4D4] focus:border-[#93C90F] focus:ring-[#93C90F]/30"
                    }`}
                >
                  {FRACTIONS.map((f, i) => (
                    <option key={i} value={i}>{f.label}</option>
                  ))}
                </select>
                <span className="text-sm text-[#666] font-mono">&quot;</span>

                {/* Apply button */}
                <button
                  onClick={handleApply}
                  disabled={applied || isResizing}
                  className={`ml-1 px-3 py-1.5 text-white text-sm rounded transition-colors font-medium whitespace-nowrap
                    ${isResizing
                      ? "bg-[#93C90F]/40 cursor-wait"
                      : applied
                        ? "bg-[#93C90F]/60 cursor-default"
                        : "bg-[#93C90F] hover:bg-[#7AB00D]"
                    }`}
                >
                  {isResizing ? (
                    <span className="flex items-center gap-1">
                      <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    </span>
                  ) : applied ? "Done" : "Apply"}
                </button>
              </div>
            ) : (
              /* Percent mode — single input */
              <div className="flex items-center gap-1.5">
                <input
                  ref={percentInputRef}
                  type="number"
                  min={1}
                  value={editPercent}
                  onChange={(e) => { setEditPercent(e.target.value); setEditError(null); }}
                  onKeyDown={handleKeyDown}
                  onFocus={(e) => e.target.select()}
                  disabled={isResizing}
                  className={`flex-1 px-2 py-1.5 text-sm border rounded font-mono
                    focus:outline-none focus:ring-1
                    ${editError
                      ? "border-red-400 focus:border-red-500 focus:ring-red-300/30"
                      : applied
                        ? "border-[#93C90F] bg-[#93C90F]/5"
                        : "border-[#D4D4D4] focus:border-[#93C90F] focus:ring-[#93C90F]/30"
                    }`}
                  placeholder="e.g. 110"
                />
                <span className="text-sm text-[#666]">%</span>
                <button
                  onClick={handleApply}
                  disabled={applied || isResizing}
                  className={`px-3 py-1.5 text-white text-sm rounded transition-colors font-medium
                    ${isResizing
                      ? "bg-[#93C90F]/40 cursor-wait"
                      : applied
                        ? "bg-[#93C90F]/60 cursor-default"
                        : "bg-[#93C90F] hover:bg-[#7AB00D]"
                    }`}
                >
                  {isResizing ? (
                    <span className="flex items-center gap-1">
                      <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    </span>
                  ) : applied ? "Done" : "Apply"}
                </button>
              </div>
            )}

            {/* Optional AI instruction */}
            <textarea
              value={userInstruction}
              onChange={(e) => setUserInstruction(e.target.value)}
              placeholder="Optional: describe how to resize (e.g., 'reduce height but keep diameter')"
              disabled={isResizing}
              className="mt-2 w-full px-2 py-1.5 text-xs border border-[#D4D4D4] rounded resize-none
                focus:outline-none focus:ring-1 focus:border-[#93C90F] focus:ring-[#93C90F]/30
                placeholder:text-[#999]"
              rows={2}
            />

            {/* Error / success / AI feedback */}
            {editError && (
              <div className="mt-1.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
                {editError}
              </div>
            )}
            {resizeError && (
              <div className="mt-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                {resizeError}
              </div>
            )}
            {applied && lastResizeReasoning && (
              <div className="mt-1.5 text-[10px] text-[#666] bg-[#F0F7E3] border border-[#C5D99B] rounded px-2 py-1">
                <span className="font-medium text-[#93C90F]">AI: </span>
                {lastResizeReasoning}
              </div>
            )}
            {applied && !lastResizeReasoning && (
              <div className="mt-1.5 text-xs text-[#93C90F] font-medium">
                Dimension updated
              </div>
            )}

            {/* Cascade suggestions panel */}
            {cascadeSuggestions.length > 0 && (
              <div className="mt-2 border border-[#00BFDD]/40 rounded-lg bg-[#F0FBFD] p-2">
                <div className="text-[10px] font-semibold text-[#007A8F] mb-1.5 tracking-wide uppercase">
                  Nearby Dimensions
                </div>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {cascadeSuggestions.map((s, i) => (
                    <CascadeRow
                      key={s.dimensionId}
                      suggestion={s}
                      onApply={() => applyCascadeSuggestion(i)}
                      onSkip={() => {
                        // Remove this suggestion from the list manually
                        const { cascadeSuggestions: current } = useCADStore.getState();
                        useCADStore.setState({
                          cascadeSuggestions: current.filter((_, idx) => idx !== i),
                        });
                      }}
                    />
                  ))}
                </div>
                <div className="flex gap-1.5 mt-2">
                  {(() => {
                    const highCount = cascadeSuggestions.filter(s => s.confidence === "high").length;
                    const total = cascadeSuggestions.length;
                    return (
                      <>
                        <button
                          onClick={applyCascadeAll}
                          className="flex-1 text-[10px] py-1 px-2 rounded bg-[#00BFDD] text-white font-medium hover:bg-[#00A3BE] transition-colors"
                        >
                          Apply All ({total})
                        </button>
                        {highCount > 0 && highCount < total && (
                          <button
                            onClick={applyCascadeHighConfidence}
                            className="flex-1 text-[10px] py-1 px-2 rounded bg-[#93C90F] text-white font-medium hover:bg-[#7AB00D] transition-colors"
                          >
                            Apply High ({highCount})
                          </button>
                        )}
                      </>
                    );
                  })()}
                  <button
                    onClick={() => {
                      dismissCascade();
                      setApplied(false);
                      selectDimension(null);
                    }}
                    className="flex-1 text-[10px] py-1 px-2 rounded bg-[#F0F0F0] text-[#666] border border-[#D4D4D4] font-medium hover:bg-[#E0E0E0] transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {/* Constraint violations (Feature 5) */}
            {constraintViolations.length > 0 && (() => {
              const dimViolations = constraintViolations.filter(v => {
                const constraint = useCADStore.getState().constraints.find(c => c.id === v.constraintId);
                return constraint?.dimensionIds.includes(selectedDim.id);
              });
              if (dimViolations.length === 0) return null;
              return (
                <div className="mt-2 space-y-1">
                  {dimViolations.map(v => (
                    <div
                      key={v.constraintId}
                      className={`text-[10px] px-2 py-1 rounded border ${
                        v.severity === "error"
                          ? "bg-red-50 border-red-200 text-red-700"
                          : "bg-amber-50 border-amber-200 text-amber-700"
                      }`}
                    >
                      {v.severity === "error" ? "\u26D4" : "\u26A0\uFE0F"} {v.label}: {v.message}
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* Info */}
            <div className="mt-2 text-[10px] text-[#999] space-y-0.5">
              <div>
                Current: <span className="font-mono text-[#666]">{selectedDim.displayText}</span>
                {" "}({formatImperialDimension(selectedDim.value)})
              </div>
              {newVal !== null && newVal !== selectedDim.value && (
                <div className="text-[#93C90F] font-medium">
                  New: <span className="font-mono">{formatImperialDimension(newVal)}</span>
                  {" "}({newVal > selectedDim.value ? "+" : ""}{((newVal / selectedDim.value - 1) * 100).toFixed(1)}%)
                </div>
              )}
              <div>
                Direction: {selectedDim.direction} | Linked entities: {selectedDim.geometryHandles.length}
              </div>
            </div>

            {/* Close button */}
            <button
              onClick={() => selectDimension(null)}
              className="absolute top-1.5 right-1.5 text-[#999] hover:text-[#0C121D] text-sm leading-none p-1"
            >
              ×
            </button>
          </div>
        );
      })()}
    </>
  );
}
