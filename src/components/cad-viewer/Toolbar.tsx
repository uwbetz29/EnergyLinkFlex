"use client";

import { useRef, useCallback } from "react";
import { useCADStore } from "@/lib/cad/store";
import { Separator } from "@/components/ui/separator";
import {
  Upload,
  Download,
  ZoomIn,
  ZoomOut,
  Maximize,
  RotateCcw,
  Layers,
  MousePointer,
  Ruler,
  Menu,
} from "lucide-react";

interface ToolbarProps {
  onToggleLayers?: () => void;
  showLayers?: boolean;
  onMenuClick?: () => void;
  projectName?: string;
}

function ToolbarButton({
  onClick,
  disabled,
  title,
  active,
  children,
}: {
  onClick?: () => void;
  disabled?: boolean;
  title: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`h-8 w-8 inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors
        ${active ? "bg-[#93C90F]/10 text-[#93C90F]" : "text-[#555] hover:bg-[#F6F6F6] hover:text-[#222]"}
        ${disabled ? "opacity-30 pointer-events-none" : ""}
      `}
    >
      {children}
    </button>
  );
}

export function Toolbar({ onToggleLayers, showLayers, onMenuClick, projectName }: ToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { drawing, isLoading, error, loadDXFFile, undo, scaleHistory } =
    useCADStore();

  const handleFileUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const ext = file.name.split(".").pop()?.toLowerCase();

      if (ext === "dwg") {
        // DWG files need server-side conversion to DXF
        const formData = new FormData();
        formData.append("file", file);
        try {
          useCADStore.setState({ isLoading: true, error: null });
          const res = await fetch("/api/convert", {
            method: "POST",
            body: formData,
          });
          if (!res.ok) {
            const errText = await res.text();
            throw new Error(errText || "DWG conversion failed");
          }
          const dxfContent = await res.text();
          loadDXFFile(dxfContent, file.name);
        } catch (err) {
          useCADStore.setState({
            isLoading: false,
            error: err instanceof Error ? err.message : "Failed to convert DWG file",
          });
        }
      } else {
        // DXF files can be read directly as text
        const reader = new FileReader();
        reader.onload = (e) => {
          const content = e.target?.result as string;
          loadDXFFile(content, file.name);
        };
        reader.readAsText(file);
      }

      event.target.value = "";
    },
    [loadDXFFile]
  );

  const handleExportDXF = useCallback(() => {
    alert("DXF export coming soon!");
  }, []);

  return (
    <div className="flex items-center gap-1 px-3 py-2 bg-white border-b border-[#E7E7E7]">
      {/* Menu + Logo */}
      <ToolbarButton title="Projects" onClick={onMenuClick}>
        <Menu className="w-4 h-4" />
      </ToolbarButton>
      <div className="flex items-center gap-2 mr-3">
        <div className="w-6 h-6 bg-[#93C90F] rounded flex items-center justify-center">
          <Ruler className="w-3 h-3 text-white" />
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold tracking-tight leading-none">
            ENERGY<span className="text-[#00BFDD]">LINK</span>
          </span>
          {projectName && (
            <span className="text-[10px] text-[#999] leading-none mt-0.5 truncate max-w-[150px]">
              {projectName}
            </span>
          )}
        </div>
      </div>

      <Separator orientation="vertical" className="h-6 mx-1" />

      <input
        ref={fileInputRef}
        type="file"
        accept=".dxf,.dwg"
        className="hidden"
        onChange={handleFileUpload}
      />

      <ToolbarButton
        title="Upload DXF/DWG File"
        onClick={() => fileInputRef.current?.click()}
        disabled={isLoading}
      >
        <Upload className="w-4 h-4" />
      </ToolbarButton>

      <ToolbarButton
        title="Export DXF"
        onClick={handleExportDXF}
        disabled={!drawing}
      >
        <Download className="w-4 h-4" />
      </ToolbarButton>

      <Separator orientation="vertical" className="h-6 mx-1" />

      <ToolbarButton title="Zoom In" disabled={!drawing}>
        <ZoomIn className="w-4 h-4" />
      </ToolbarButton>

      <ToolbarButton title="Zoom Out" disabled={!drawing}>
        <ZoomOut className="w-4 h-4" />
      </ToolbarButton>

      <ToolbarButton title="Fit to View" disabled={!drawing}>
        <Maximize className="w-4 h-4" />
      </ToolbarButton>

      <Separator orientation="vertical" className="h-6 mx-1" />

      <ToolbarButton title="Select Component" disabled={!drawing}>
        <MousePointer className="w-4 h-4" />
      </ToolbarButton>

      <ToolbarButton
        title="Toggle Layers Panel"
        onClick={onToggleLayers}
        disabled={!drawing}
        active={showLayers}
      >
        <Layers className="w-4 h-4" />
      </ToolbarButton>

      <Separator orientation="vertical" className="h-6 mx-1" />

      <ToolbarButton
        title="Undo Last Scale"
        onClick={undo}
        disabled={scaleHistory.length === 0}
      >
        <RotateCcw className="w-4 h-4" />
      </ToolbarButton>

      {/* Status */}
      <div className="ml-auto flex items-center gap-2 text-xs text-[#888]">
        {isLoading && <span className="text-[#00BFDD]">Loading...</span>}
        {error && (
          <span className="text-red-500 max-w-xs truncate" title={error}>
            {error}
          </span>
        )}
        {drawing && (
          <>
            <span className="text-[#333] font-medium">{drawing.fileName}</span>
            <span className="text-[#ddd]">|</span>
            <span>{drawing.entities.length} entities</span>
            <span className="text-[#ddd]">|</span>
            <span>{drawing.components.length} components</span>
            <span className="text-[#ddd]">|</span>
            <span>{drawing.layers.length} layers</span>
          </>
        )}
      </div>
    </div>
  );
}
