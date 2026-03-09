"use client";

import { useState, useRef, useCallback } from "react";
import { CADCanvas } from "@/components/cad-viewer/CADCanvas";
import { useCADStore } from "@/lib/cad/store";
import { processCADFile, type ProcessingPhase } from "@/lib/cad/file-processing";
import {
  Upload,
  RotateCcw,
  RotateCw,
  Loader2,
  FileText,
  FileImage,
  Sparkles,
  BoxSelect,
  GitCompare,
} from "lucide-react";

const TEST_FILES = [
  {
    label: "PDF — 24189-CS1-0001",
    path: "/Users/mike/Library/CloudStorage/GoogleDrive-mikebetz.com@gmail.com/My Drive/Claude Code Projects/EnergyLinkFlex/Drawings/24189-CS1-0001_0.pdf",
    type: "pdf",
  },
  {
    label: "DWG — 25037-CS1-0010",
    path: "/Users/mike/Library/CloudStorage/GoogleDrive-mikebetz.com@gmail.com/My Drive/Claude Code Projects/EnergyLinkFlex/Drawings/25037-CS1-0010.dwg",
    type: "dwg",
  },
];
import Image from "next/image";

// Expose store for dev testing
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__cadStore = useCADStore;
}

/**
 * Standalone test viewer — bypasses auth & project store.
 * Upload a DXF/DWG/PDF directly and test parametric dimensions.
 */
export default function TestViewerPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<ProcessingPhase | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const drawing = useCADStore((s) => s.drawing);
  const dimensions = useCADStore((s) => s.dimensions);
  const isLoading = useCADStore((s) => s.isLoading);
  const error = useCADStore((s) => s.error);
  const {
    undo, redo, scaleHistory, redoStack, pdfPageCount, pdfCurrentPage, setPDFPage,
    isRecognizing, componentGraph, recognizeComponents,
    showComponentOverlay, toggleComponentOverlay,
    showDiff, toggleDiff, originalDrawingSnapshot,
  } = useCADStore();

  const handleFileUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      setUploadError(null);
      try {
        await processCADFile(file, setPhase);
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "Upload failed");
      }
      setPhase(null);
      event.target.value = "";
    },
    []
  );

  const loadTestFile = useCallback(async (filePath: string) => {
    setUploadError(null);
    setPhase("extracting");
    try {
      const res = await fetch("/api/test-load", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Load failed" }));
        throw new Error(err.error || "Load failed");
      }
      const { type, data } = await res.json();
      setPhase("detecting");
      if (type === "pdf") {
        const fileName = filePath.split("/").pop() || "test.pdf";
        useCADStore.getState().loadPDFEntities(data, fileName);
      } else {
        const fileName = filePath.split("/").pop()?.replace(/\.dwg$/i, ".dxf") || "test.dxf";
        useCADStore.getState().loadDXFFile(data, fileName);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Load failed");
    }
    setPhase(null);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-white text-[#0C121D]">
      {/* Toolbar */}
      <header className="flex items-center h-14 px-4 bg-white border-b border-[#D4D4D4]">
        <div className="flex items-center gap-3">
          <Image
            src="/logo.png"
            alt="EnergyLink FLEX"
            width={706}
            height={149}
            className="h-9 w-auto"
            unoptimized
          />
          <div className="w-px h-5 bg-[#D4D4D4]" />
          <span className="text-sm font-medium text-[#0C121D]">Test Viewer</span>
        </div>

        <div className="flex-1 flex items-center justify-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".dxf,.dwg,.pdf"
            className="hidden"
            onChange={handleFileUpload}
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-[#93C90F] hover:bg-[#7AB00D] text-white rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {phase ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {phase === "converting" ? "Converting DWG..." :
                 phase === "extracting" ? "Extracting PDF..." :
                 phase === "parsing" ? "Parsing..." :
                 phase === "detecting" ? "Detecting dimensions..." : "Loading..."}
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Upload File
              </>
            )}
          </button>

          {!drawing && !isLoading && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[#999]">Quick load:</span>
              {TEST_FILES.map((tf) => (
                <button
                  key={tf.path}
                  onClick={() => loadTestFile(tf.path)}
                  className="flex items-center gap-1 px-2 py-1 text-xs bg-[#EBEBEB] hover:bg-[#E0E0E0] text-[#666] rounded border border-[#D4D4D4] transition-colors"
                >
                  {tf.type === "pdf" ? (
                    <FileImage className="w-3 h-3 text-red-400" />
                  ) : (
                    <FileText className="w-3 h-3 text-blue-400" />
                  )}
                  {tf.label}
                </button>
              ))}
            </div>
          )}

          {drawing && (
            <>
              <div className="flex items-center gap-1 px-1.5 py-1 bg-[#EBEBEB] rounded-lg border border-[#D4D4D4]/60">
                <ToolButton title="Undo" onClick={undo} disabled={scaleHistory.length === 0}>
                  <RotateCcw className="w-3.5 h-3.5" />
                </ToolButton>
                <ToolButton title="Redo" onClick={redo} disabled={redoStack.length === 0}>
                  <RotateCw className="w-3.5 h-3.5" />
                </ToolButton>
              </div>

              <div className="flex items-center gap-1 px-1.5 py-1 bg-[#EBEBEB] rounded-lg border border-[#D4D4D4]/60">
                <button
                  title={componentGraph ? `Components: ${componentGraph.components.length} detected` : "Analyze Drawing (AI)"}
                  onClick={recognizeComponents}
                  disabled={isRecognizing}
                  className={`h-7 px-2 inline-flex items-center gap-1.5 rounded-md text-xs font-medium transition-colors
                    ${componentGraph ? "bg-[#93C90F]/25 text-[#5A7D00]" : "text-[#666] hover:bg-[#E0E0E0] hover:text-[#0C121D]"}
                    ${isRecognizing ? "opacity-50 pointer-events-none" : ""}
                  `}
                >
                  {isRecognizing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  {isRecognizing ? "Analyzing..." : componentGraph ? `${componentGraph.components.length} components` : "Analyze"}
                </button>
                {componentGraph && (
                  <ToolButton
                    title={showComponentOverlay ? "Hide component boxes" : "Show component boxes"}
                    onClick={toggleComponentOverlay}
                  >
                    <BoxSelect className={`w-3.5 h-3.5 ${showComponentOverlay ? "text-[#93C90F]" : ""}`} />
                  </ToolButton>
                )}
                {originalDrawingSnapshot && (
                  <ToolButton
                    title={showDiff ? "Hide changes" : "Show changes (before/after)"}
                    onClick={toggleDiff}
                  >
                    <GitCompare className={`w-3.5 h-3.5 ${showDiff ? "text-[#93C90F]" : ""}`} />
                  </ToolButton>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-[#999]">
          {isLoading && <span className="text-[#00BFDD] animate-pulse">Loading...</span>}
          {error && <span className="text-red-500 truncate max-w-[200px]">{error}</span>}
          {uploadError && <span className="text-red-500 truncate max-w-[200px]">{uploadError}</span>}
          {drawing && !isLoading && (
            <span>
              {drawing.entities.length} entities | {dimensions.length} dimensions
            </span>
          )}
        </div>
      </header>

      {/* PDF page tabs */}
      {pdfPageCount > 1 && (
        <div className="h-9 bg-[#F0F0F0] border-b border-[#D4D4D4] flex items-end px-3 gap-0.5">
          {Array.from({ length: pdfPageCount }, (_, i) => i + 1).map((page) => (
            <button
              key={page}
              onClick={() => setPDFPage(page)}
              className={`px-3 py-1.5 text-xs rounded-t-md transition-colors border border-b-0 ${
                page === pdfCurrentPage
                  ? "bg-white text-[#0C121D] font-semibold border-[#D4D4D4]"
                  : "bg-[#E5E5E5] text-[#666] border-transparent hover:bg-[#EBEBEB]"
              }`}
            >
              Page {page}
            </button>
          ))}
        </div>
      )}

      {/* Canvas (includes DimensionOverlay inside) */}
      <div className="flex-1 overflow-hidden">
        <CADCanvas />
      </div>

      {/* Status bar */}
      <div className="h-6 bg-[#F0F0F0] border-t border-[#D4D4D4] flex items-center px-3 text-[10px] text-[#999]">
        <span>EnergyLink FLEX — Test Viewer (no auth)</span>
        <span className="mx-2">|</span>
        <span>Click+Drag to pan, Scroll to zoom, Click dimension labels to edit</span>
        {drawing && (
          <>
            <span className="mx-2">|</span>
            <span>{drawing.entities.length} entities, {drawing.layers.length} layers</span>
          </>
        )}
      </div>
    </div>
  );
}

function ToolButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick?: () => void;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`h-7 w-7 inline-flex items-center justify-center rounded-md text-xs transition-colors
        text-[#666] hover:bg-[#E0E0E0] hover:text-[#0C121D]
        ${disabled ? "opacity-30 pointer-events-none" : ""}
      `}
    >
      {children}
    </button>
  );
}
