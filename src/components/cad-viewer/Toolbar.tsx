"use client";

import { useRef, useCallback } from "react";
import { useCADStore } from "@/lib/cad/store";
import { processCADFile } from "@/lib/cad/file-processing";
import {
  Menu,
  Upload,
  ZoomIn,
  ZoomOut,
  Maximize,
  RotateCcw,
  RotateCw,
  Sparkles,
  BoxSelect,
  GitCompare,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useProjectStore } from "@/lib/projects/store";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";

interface ToolbarProps {
  onToggleSidebar?: () => void;
  showSidebar?: boolean;
  projectName?: string;
}

function ToolButton({
  onClick,
  disabled,
  title,
  description,
  shortcut,
  active,
  children,
}: {
  onClick?: () => void;
  disabled?: boolean;
  title: string;
  description?: string;
  shortcut?: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  const btn = (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`h-7 w-7 inline-flex items-center justify-center rounded-md text-xs transition-colors
        ${active ? "bg-[#93C90F]/25 text-[#5A7D00]" : "text-[#666] hover:bg-[#E0E0E0] hover:text-[#0C121D]"}
        ${disabled ? "opacity-30 pointer-events-none" : ""}
      `}
    >
      {children}
    </button>
  );

  return (
    <Tooltip>
      <TooltipTrigger render={<div className="inline-flex" />}>
        {btn}
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={8}>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="font-medium">{title}</span>
            {shortcut && (
              <kbd className="text-[10px] px-1 py-0.5 rounded bg-white/15 font-mono">{shortcut}</kbd>
            )}
          </div>
          {description && (
            <span className="text-[10px] opacity-70 font-normal">{description}</span>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function ToolGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-0.5 px-1.5 py-1 bg-[#EBEBEB] rounded-lg border border-[#D4D4D4]/60">
      {children}
    </div>
  );
}

export function Toolbar({ onToggleSidebar, showSidebar, projectName }: ToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    drawing, isLoading, error, undo, redo, scaleHistory, redoStack,
    isRecognizing, componentGraph, recognizeComponents,
    showComponentOverlay, toggleComponentOverlay,
    showDiff, toggleDiff, originalDrawingSnapshot,
  } = useCADStore();
  const { currentProjectId, addDrawing } = useProjectStore();

  const handleFileUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file || !currentProjectId) return;
      try {
        const result = await processCADFile(file);
        await addDrawing(currentProjectId, {
          name: result.fileName.replace(/\.(dxf|dwg|pdf)$/i, ""),
          fileName: result.fileName,
          dxfContent: result.dxfContent,
          fileSizeBytes: result.fileSize,
        });
      } catch (err) {
        console.error("Upload failed:", err);
      }
      event.target.value = "";
    },
    [currentProjectId, addDrawing]
  );

  return (
    <TooltipProvider delay={300}>
    <header className="flex items-center h-14 px-4 bg-white border-b border-[#D4D4D4]">
      {/* Left: Hamburger + Logo + Project name */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onToggleSidebar}
          title={showSidebar ? "Hide sidebar" : "Show sidebar"}
          className="h-8 w-8 inline-flex items-center justify-center rounded-md text-[#666] hover:bg-[#E0E0E0] hover:text-[#0C121D] transition-colors flex-shrink-0"
        >
          <Menu className="w-4 h-4" />
        </button>
        <Link href="/" className="flex-shrink-0">
          <Image
            src="/logo.png"
            alt="EnergyLink FLEX"
            width={706}
            height={149}
            className="h-9 w-auto"
            unoptimized
          />
        </Link>

        {projectName && (
          <>
            <div className="w-px h-5 bg-[#D4D4D4]" />
            <span className="text-sm font-medium text-[#0C121D] truncate max-w-[200px]">
              {projectName}
            </span>
          </>
        )}
      </div>

      {/* Center: Tool groups */}
      <div className="flex-1 flex items-center justify-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".dxf,.dwg,.pdf"
          className="hidden"
          onChange={handleFileUpload}
        />

        {/* View tools */}
        <ToolGroup>
          <ToolButton title="Zoom In" description="Scroll wheel also zooms" disabled={!drawing}>
            <ZoomIn className="w-3.5 h-3.5" />
          </ToolButton>
          <ToolButton title="Zoom Out" disabled={!drawing}>
            <ZoomOut className="w-3.5 h-3.5" />
          </ToolButton>
          <ToolButton title="Fit to View" description="Reset view to show entire drawing" disabled={!drawing}>
            <Maximize className="w-3.5 h-3.5" />
          </ToolButton>
        </ToolGroup>

        {/* Edit tools */}
        <ToolGroup>
          <ToolButton
            title="Undo"
            description="Revert last dimension change"
            shortcut="Ctrl+Z"
            onClick={undo}
            disabled={scaleHistory.length === 0}
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </ToolButton>
          <ToolButton
            title="Redo"
            shortcut="Ctrl+Y"
            onClick={redo}
            disabled={redoStack.length === 0}
          >
            <RotateCw className="w-3.5 h-3.5" />
          </ToolButton>
        </ToolGroup>

        {/* Upload (secondary — for adding files to existing projects) */}
        <ToolButton
          title="Upload File"
          description="Add another DXF, DWG, or PDF"
          onClick={() => fileInputRef.current?.click()}
          disabled={isLoading}
        >
          <Upload className="w-3.5 h-3.5" />
        </ToolButton>

        {/* AI Analyze */}
        <ToolGroup>
          <ToolButton
            title={componentGraph ? `${componentGraph.components.length} Components Detected` : "AI Analysis"}
            description={componentGraph ? "Re-analyze to refresh components" : "Identify components, map dimensions"}
            onClick={recognizeComponents}
            disabled={!drawing || isRecognizing}
            active={!!componentGraph}
          >
            {isRecognizing ? (
              <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
          </ToolButton>
          {componentGraph && (
            <ToolButton
              title={showComponentOverlay ? "Hide Boxes" : "Show Component Boxes"}
              description="Toggle colored bounding boxes around each component"
              onClick={toggleComponentOverlay}
              active={showComponentOverlay}
            >
              <BoxSelect className="w-3.5 h-3.5" />
            </ToolButton>
          )}
          {originalDrawingSnapshot && (
            <ToolButton
              title={showDiff ? "Hide Changes" : "Show Changes"}
              description="Compare current drawing with original (before edits)"
              onClick={toggleDiff}
              active={showDiff}
            >
              <GitCompare className="w-3.5 h-3.5" />
            </ToolButton>
          )}
        </ToolGroup>
      </div>

      {/* Right: Status */}
      <div className="flex items-center gap-3 min-w-0">
        {isLoading && (
          <span className="text-xs text-[#00BFDD] animate-pulse">Loading...</span>
        )}
        {error && (
          <span className="text-xs text-red-500 truncate max-w-[140px]" title={error}>
            {error}
          </span>
        )}
        {drawing && !isLoading && !error && (
          <div className="hidden lg:flex items-center gap-1.5 text-[11px] text-[#999]">
            <span className="text-[#0C121D] font-medium truncate max-w-[120px]">{drawing.fileName}</span>
            <span className="text-[#D4D4D4]">|</span>
            <span>{drawing.entities.length} entities</span>
          </div>
        )}
      </div>
    </header>
    </TooltipProvider>
  );
}
