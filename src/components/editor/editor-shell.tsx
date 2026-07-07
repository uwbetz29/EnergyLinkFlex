"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useEditorStore } from "@/stores/editor-store";
import { TITAN_PGM130_COMPONENTS } from "./component-data";
import { DrawingCanvas } from "./drawing-canvas";
import { SvgDrawingCanvas } from "./svg-drawing-canvas";
import { ComponentSidebar } from "./component-sidebar";
import { NLBar } from "./nl-bar";
import { StageNav } from "./stage-nav";
import Link from "next/link";
import { ArrowLeft, Undo2, Download, Loader2, Layers } from "lucide-react";
import { getProject } from "@/app/projects/actions";
import { toEditorComponents, parseSvgViewBox } from "@/lib/dwg/extractor";
import type { AiSection } from "@/lib/ai/prescan";
import type { ComponentDef } from "@/stores/editor-store";
import type { SheetType } from "@/lib/dwg/sheet-type";

/** Convert AI pre-scan sections into editor ComponentDefs */
function aiSectionsToComponents(
  sections: AiSection[]
): Record<string, ComponentDef> {
  const comps: Record<string, ComponentDef> = {};
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const id = `ai-${i}-${s.name.replace(/\s+/g, "-").toLowerCase()}`;
    comps[id] = {
      id,
      name: s.name,
      type: s.type,
      color: s.color,
      icon: s.icon,
      box: s.box,
      dims: s.dims,
      dimBlocks: s.dimBlocks,
      mainDim: s.mainDim,
      constraints: [],
      downstream: s.downstream,
      upstream: s.upstream,
      notes: s.notes,
    };
  }
  return comps;
}

export function EditorShell() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project");

  const {
    changeCount,
    projectName,
    drawingType,
    sheets,
    activeSheetIndex,
    sheetType,
    setComponents,
    setPdfUrl,
    setSvgUrl,
    setProject,
    setDrawingType,
    setDwgData,
    setSheets,
    setSheetType,
    setActiveSheet,
  } = useEditorStore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      // Demo mode: load static drawing
      setComponents(TITAN_PGM130_COMPONENTS);
      setPdfUrl("/drawings/24189-CS1-0001_0.pdf");
      setProject("demo", "TITAN PGM 130 — Demo Drawing");
      setDrawingType("pdf");
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function loadProject() {
      try {
        setLoading(true);
        setError(null);

        const project = await getProject(projectId!);
        if (cancelled) return;

        setProject(project.id, project.name);
        setDrawingType(project.drawing_type);

        if (project.drawing_type === "dwg") {
          // Multi-sheet DWG: load all sheets if available
          if (project.dwg_sheets && project.dwg_sheets.length > 0) {
            setSheets(project.dwg_sheets);
            // setActiveSheet(0) is called inside setSheets,
            // which sets svgUrl, components, layers, etc. for sheet 0
            const firstSheet = project.dwg_sheets[0];
            setSheetType(firstSheet.sheetType ?? "GA");

            // Convert first sheet's components to editor ComponentDefs
            let viewBox = { minX: 0, minY: 0, width: 1600, height: 900 };
            if (firstSheet.svgUrl) {
              try {
                const svgRes = await fetch(firstSheet.svgUrl, {
                  headers: { Range: "bytes=0-500" },
                });
                const svgHeader = await svgRes.text();
                viewBox = parseSvgViewBox(svgHeader);
              } catch {
                // Use default viewBox
              }
            }

            setDwgData(
              firstSheet.components,
              firstSheet.layers,
              firstSheet.metadata
            );
            const editorComps = toEditorComponents(
              firstSheet.components,
              viewBox
            );
            setComponents(editorComps);
            useEditorStore.getState().toggleOverlays();
          } else {
            // Single-sheet DWG (backward compat)
            setSheetType((project.dwg_sheet_type as SheetType) ?? "GA");
            if (project.svg_url) {
              setSvgUrl(project.svg_url);
            }
            if (project.dwg_components && project.dwg_layers) {
              setDwgData(
                project.dwg_components,
                project.dwg_layers,
                project.dwg_metadata
              );

              // Prefer AI-identified sections over auto-extracted DWG blocks
              if (
                project.dwg_ai_sections &&
                project.dwg_ai_sections.sections?.length > 0
              ) {
                const editorComps = aiSectionsToComponents(
                  project.dwg_ai_sections.sections
                );
                setComponents(editorComps);
                console.log(
                  `[ELF] Loaded ${Object.keys(editorComps).length} AI-identified sections`
                );
              } else {
                // Fallback: auto-extracted DWG blocks
                let viewBox = {
                  minX: 0,
                  minY: 0,
                  width: 1600,
                  height: 900,
                };
                if (project.svg_url) {
                  try {
                    const svgRes = await fetch(project.svg_url, {
                      headers: { Range: "bytes=0-500" },
                    });
                    const svgHeader = await svgRes.text();
                    viewBox = parseSvgViewBox(svgHeader);
                  } catch {
                    // Use default viewBox
                  }
                }
                const editorComps = toEditorComponents(
                  project.dwg_components,
                  viewBox
                );
                setComponents(editorComps);
              }
              useEditorStore.getState().toggleOverlays();
            }
          }
        } else {
          // PDF project: existing flow
          if (project.pdf_url) {
            setPdfUrl(project.pdf_url);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load project"
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadProject();
    return () => {
      cancelled = true;
    };
  }, [projectId, setPdfUrl, setSvgUrl, setProject, setComponents, setDrawingType, setDwgData, setSheets, setSheetType]);

  if (loading) {
    return (
      <div className="flex flex-col h-screen items-center justify-center bg-[#f0f0f4]">
        <Loader2 className="w-8 h-8 text-gray-300 animate-spin" />
        <div className="text-gray-400 text-sm mt-3">Loading project...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col h-screen items-center justify-center bg-[#f0f0f4] gap-4">
        <div className="text-red-500 text-sm">{error}</div>
        <Link
          href="/"
          className="text-gray-400 hover:text-gray-700 text-sm underline"
        >
          Back to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* ─── Top Bar ─── */}
      <div
        className="h-[52px] flex items-center px-4 gap-3.5 flex-shrink-0 z-50 border-b border-white/[0.06]"
        style={{
          background:
            "linear-gradient(135deg, #001030 0%, #001a4d 50%, #002e81 100%)",
        }}
      >
        {/* Back button */}
        <Link
          href="/"
          className="text-white/40 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>

        {/* Logo */}
        <div className="flex items-center gap-2 text-white font-bold text-[14px] tracking-[0.3px] whitespace-nowrap">
          ENERGYLINK
          <span className="bg-gradient-to-br from-blue-400 to-blue-700 text-white px-1.5 py-0.5 rounded text-[11px] font-extrabold tracking-wider">
            FLEX
          </span>
        </div>
        <div className="w-px h-6 bg-white/12" />

        {/* Project name + drawing type badge */}
        <div className="text-white/90 text-[13px] font-semibold flex-1 truncate flex items-center gap-2">
          {projectName || "Untitled Project"}
          {drawingType === "dwg" && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              DWG
            </span>
          )}
        </div>

        {/* Stage navigation */}
        <StageNav />

        {/* Actions */}
        <div className="flex gap-1.5 items-center">
          <button className="px-3 py-1.5 rounded-[7px] text-[11px] font-semibold border border-white/15 bg-white/6 text-white/70 hover:bg-white/12 hover:text-white transition-all flex items-center gap-1.5">
            <Undo2 className="w-3 h-3" />
            Undo
          </button>
          <button className="px-3 py-1.5 rounded-[7px] text-[11px] font-bold bg-white text-[#002e81] hover:bg-[#e6eeff] transition-all flex items-center gap-1.5">
            <Download className="w-3 h-3" />
            Export
            {changeCount > 0 && (
              <span className="bg-[#002e81] text-white text-[9px] px-1.5 py-0.5 rounded-full font-bold">
                {changeCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ─── Sheet Tabs (multi-sheet DWG only) ─── */}
      {sheets.length > 1 && (
        <div
          className="h-[36px] flex items-center px-4 gap-1 flex-shrink-0 border-b border-gray-200"
          style={{ background: "#f8f9fc" }}
        >
          <Layers className="w-3.5 h-3.5 text-gray-400 mr-1.5" />
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mr-2">
            Sheets
          </span>
          {sheets.map((sheet, idx) => {
            const isActive = idx === activeSheetIndex;
            return (
              <button
                key={sheet.sheetNumber}
                onClick={() => {
                  if (!isActive) {
                    setActiveSheet(idx);
                    // Re-convert components for the new sheet
                    const s = sheets[idx];
                    const editorComps = toEditorComponents(
                      s.components,
                      { minX: 0, minY: 0, width: 1600, height: 900 }
                    );
                    setComponents(editorComps);
                  }
                }}
                className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-all ${
                  isActive
                    ? "bg-white text-blue-700 border border-blue-200 shadow-sm"
                    : "text-gray-500 hover:text-gray-700 hover:bg-white/60 border border-transparent"
                }`}
              >
                {sheet.label}
                {sheet.correlationMap && Object.keys(sheet.correlationMap).length > 0 && (
                  <span className="ml-1.5 text-[9px] text-emerald-500 font-bold">
                    ↔{Object.keys(sheet.correlationMap).length}
                  </span>
                )}
              </button>
            );
          })}
          <span className="ml-auto text-[10px] text-gray-400">
            {sheets.reduce((n, s) => n + s.components.length, 0)} components across {sheets.length} views
          </span>
        </div>
      )}

      {/* ─── Main Area ─── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left drawer: component nav + embedded AI configurator */}
        <aside className="w-[340px] flex-shrink-0 flex flex-col bg-white z-20 overflow-hidden shadow-[4px_0_30px_rgba(0,0,0,0.12)]">
          {sheetType !== "PID" && <ComponentSidebar />}
          {/* AI Configurator — natural language dimension modification */}
          {sheetType !== "PID" && <NLBar />}
        </aside>

        {drawingType === "dwg" ? <SvgDrawingCanvas /> : <DrawingCanvas />}
      </div>
    </div>
  );
}
