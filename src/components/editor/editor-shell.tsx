"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useEditorStore } from "@/stores/editor-store";
import { TITAN_PGM130_COMPONENTS } from "./component-data";
import { DrawingCanvas } from "./drawing-canvas";
import { SvgDrawingCanvas } from "./svg-drawing-canvas";
import { ComponentSidebar } from "./component-sidebar";
import { NLBar } from "./nl-bar";
import { StageNav } from "./stage-nav";
import { ChangeLedgerPanel } from "./change-ledger-panel";
import Link from "next/link";
import { ArrowLeft, Undo2, Redo2, Download, Loader2, Layers, Check, FileText, Image as ImageIcon, Package, Eye } from "lucide-react";
import { getProject } from "@/app/projects/actions";
import { exportDrawingPdf, exportDrawingPng, exportBidPackage, type ExportOptions } from "@/lib/dwg/drawing-export";
import { toEditorComponents, parseSvgViewBox } from "@/lib/dwg/extractor";
import type { AiSection } from "@/lib/ai/prescan";
import type { ComponentDef } from "@/stores/editor-store";
import type { SheetType } from "@/lib/dwg/sheet-type";
import type { Markup } from "@/lib/dwg/types";

/** Flatten a per-sheet markup map (as stored in the DB) into the flat store array. */
function flattenMarkups(
  bySheet: Record<number, Markup[]> | null | undefined
): Markup[] {
  return bySheet ? Object.values(bySheet).flat() : [];
}

/** Group the flat store array back into a per-sheet map for persistence. */
function groupMarkupsBySheet(markups: Markup[]): Record<number, Markup[]> {
  return markups.reduce((acc, m) => {
    (acc[m.sheetNumber] ??= []).push(m);
    return acc;
  }, {} as Record<number, Markup[]>);
}

const MARKUP_SAVE_DEBOUNCE_MS = 800;

/** Diff current component dims against their originals into the persistable
 *  { [compId]: { [dimKey]: editedValue } } shape (only actually-changed dims). */
function buildDimEdits(
  originals: Record<string, Record<string, string>>,
  components: Record<string, ComponentDef>
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const compId of Object.keys(originals)) {
    for (const dimKey of Object.keys(originals[compId])) {
      const cur = components[compId]?.dims[dimKey];
      if (cur !== undefined && cur !== originals[compId][dimKey]) {
        (out[compId] ??= {})[dimKey] = cur;
      }
    }
  }
  return out;
}

type SaveState = "idle" | "saving" | "saved" | "error";

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
    setMarkups,
    undo,
    redo,
    history,
    historyIndex,
    applyPersistedDimEdits,
    showDiff,
    toggleDiff,
    setShowDiff,
  } = useEditorStore();
  const markups = useEditorStore((s) => s.markups);
  const components = useEditorStore((s) => s.components);
  const originals = useEditorStore((s) => s.originals);
  const dwgMetadata = useEditorStore((s) => s.dwgMetadata);
  const svgViewBox = useEditorStore((s) => s.svgViewBox);
  const canUndo = historyIndex >= 0;
  const canRedo = historyIndex < history.length - 1;

  // Never strand the user in the Before (original) view with nothing to diff:
  // if all changes are gone (undo/reset), force the toggle back off.
  useEffect(() => {
    if (changeCount === 0 && showDiff) setShowDiff(false);
  }, [changeCount, showDiff, setShowDiff]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [exporting, setExporting] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  // Export needs the live DWG svg + its viewBox; disabled for PDF projects
  // (no `.elf-dwg` drawing) or before the drawing has loaded.
  const canExport = drawingType === "dwg" && !!svgViewBox;
  // Set once the initial load for this projectId has finished applying any
  // persisted dim edits, so the save effect never fires mid-load.
  const dimHydratedFor = useRef<string | null>(null);

  // Guards the markup-save effect against two failure modes:
  //  1. Saving on mount before hydrate has completed (projectId is set but
  //     the store's markups are still the pre-load default / stale from a
  //     previous project) — gated by `projectId` not yet matching.
  //  2. Saving immediately after hydrate, which would PATCH back the exact
  //     data we just loaded — gated by `skipNextSave`, set right alongside
  //     the hydrating `setMarkups()` call and consumed by the very next
  //     save-effect run.
  const markupHydration = useRef<{ projectId: string | null; skipNextSave: boolean }>({
    projectId: null,
    skipNextSave: false,
  });

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

        // Hydrate markups from the persisted per-sheet blob. Arm the
        // just-hydrated guard so the save effect below doesn't immediately
        // PATCH this same data back to the server.
        markupHydration.current = { projectId: project.id, skipNextSave: true };
        setMarkups(flattenMarkups(project.dwg_markups));

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

        // Re-apply any persisted dimension edits now that components are built,
        // then mark this project hydrated so the save effect can run.
        if (project.drawing_type === "dwg") {
          applyPersistedDimEdits(project.dwg_dim_edits ?? {});
        }
        dimHydratedFor.current = project.id;
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
  }, [projectId, setPdfUrl, setSvgUrl, setProject, setComponents, setDrawingType, setDwgData, setSheets, setSheetType, setMarkups, applyPersistedDimEdits]);

  // Debounced markup persistence. Markup-only — dimension edits are handled
  // by a separate mechanism and must not be touched here.
  useEffect(() => {
    if (!projectId) return;

    const hydration = markupHydration.current;

    if (hydration.projectId !== projectId) {
      // Hydrate for this projectId hasn't completed yet (covers both the
      // initial mount, before the load resolves, and the gap right after
      // switching projects). Never save markups we haven't confirmed came
      // from a completed load — otherwise a slow load could PATCH an empty
      // (or stale, previous-project) markup set over real saved data.
      return;
    }

    if (hydration.skipNextSave) {
      // This run corresponds to the setMarkups() call made during hydrate.
      // Consume the flag so subsequent real edits are saved normally.
      hydration.skipNextSave = false;
      return;
    }

    setSaveState("saving");
    const timer = setTimeout(() => {
      fetch("/api/dwg/markups", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          markupsBySheet: groupMarkupsBySheet(markups),
        }),
      })
        .then((r) => setSaveState(r.ok ? "saved" : "error"))
        .catch((err) => {
          console.error("[ELF] Failed to save markups", err);
          setSaveState("error");
        });
    }, MARKUP_SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [markups, projectId]);

  // Debounced dimension-edit persistence. Mirrors the markup save above; gated
  // on dimHydratedFor so it never PATCHes before the initial load has applied
  // any persisted edits.
  useEffect(() => {
    if (!projectId) return;
    if (dimHydratedFor.current !== projectId) return;

    setSaveState("saving");
    const dimEdits = buildDimEdits(originals, components);
    const timer = setTimeout(() => {
      fetch("/api/dwg/dimensions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, dimEdits }),
      })
        .then((r) => setSaveState(r.ok ? "saved" : "error"))
        .catch((err) => {
          console.error("[ELF] Failed to save dimension edits", err);
          setSaveState("error");
        });
    }, MARKUP_SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [components, originals, projectId]);

  // Undo / redo keyboard shortcuts (Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z, Ctrl+Y).
  // Skip when focus is in a text field so the browser's native text undo wins.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
      const key = e.key.toLowerCase();
      if (key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (key === "y") {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  // Auto-clear a transient export error after a few seconds.
  useEffect(() => {
    if (!exportError) return;
    const t = setTimeout(() => setExportError(null), 4000);
    return () => clearTimeout(t);
  }, [exportError]);

  // Serialize the LIVE drawing (current stretches) + red markup overlay to a
  // PNG or a branded PDF. Reads the two on-screen svgs by their data-hooks so
  // the export is a snapshot of exactly what's rendered.
  async function handleExport(format: "pdf" | "png" | "bid") {
    setExportMenuOpen(false);
    const drawingSvg = document.querySelector<SVGSVGElement>(
      "[data-elf-canvas] > svg"
    );
    const markupSvg = document.querySelector<SVGSVGElement>("[data-elf-markup]");
    if (!drawingSvg || !svgViewBox) {
      setExportError("No drawing to export yet.");
      return;
    }
    setExporting(true);
    setExportError(null);
    try {
      const opts: ExportOptions = {
        drawingSvg,
        markupSvg,
        viewBox: { width: svgViewBox.width, height: svgViewBox.height },
        metadata: dwgMetadata,
        projectName,
        date: new Date(),
        components,
        originals,
      };
      if (format === "pdf") await exportDrawingPdf(opts);
      else if (format === "png") await exportDrawingPng(opts);
      else await exportBidPackage(opts);
    } catch (err) {
      console.error("[ELF] Export failed", err);
      setExportError("Export failed. Try again.");
    } finally {
      setExporting(false);
    }
  }

  // Switch to a multi-sheet DWG's Nth sheet: activate it, then rebuild the
  // component overlays against the sheet's REAL parsed viewBox (previously a
  // hardcoded 1600×900, which mis-placed the boxes until deriveComponentBoxes ran).
  async function switchSheet(idx: number) {
    setActiveSheet(idx);
    const s = sheets[idx];
    let viewBox = { minX: 0, minY: 0, width: 1600, height: 900 };
    if (s.svgUrl) {
      try {
        const res = await fetch(s.svgUrl, { headers: { Range: "bytes=0-500" } });
        viewBox = parseSvgViewBox(await res.text());
      } catch {
        // keep the default viewBox
      }
    }
    // Bail if the user switched to another sheet while we were fetching — a slow
    // fetch must not overwrite a newer sheet's components (stale-write race).
    if (useEditorStore.getState().activeSheetIndex !== idx) return;
    setComponents(toEditorComponents(s.components, viewBox));
  }

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
          {saveState !== "idle" && (
            <span
              className="text-[10px] font-semibold flex items-center gap-1 mr-1 min-w-[58px] justify-end text-white/55"
              aria-live="polite"
            >
              {saveState === "saving" && (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" /> Saving…
                </>
              )}
              {saveState === "saved" && (
                <>
                  <Check className="w-3 h-3 text-emerald-300" /> Saved
                </>
              )}
              {saveState === "error" && (
                <span className="text-red-300">Save failed</span>
              )}
            </span>
          )}
          {drawingType === "dwg" && <ChangeLedgerPanel />}
          {drawingType === "dwg" && (
            <button
              onClick={toggleDiff}
              disabled={changeCount === 0}
              title="Toggle before/after (original vs configured)"
              className={`px-3 py-1.5 rounded-[7px] text-[11px] font-semibold border border-white/15 ${
                showDiff
                  ? "bg-white/20 text-white hover:bg-white/25"
                  : "bg-white/6 text-white/70 hover:bg-white/12 hover:text-white"
              } transition-all flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white/6 disabled:hover:text-white/70`}
            >
              <Eye className="w-3 h-3" />
              {showDiff ? "After" : "Before"}
            </button>
          )}
          <button
            onClick={undo}
            disabled={!canUndo}
            title="Undo (⌘Z)"
            className="px-3 py-1.5 rounded-[7px] text-[11px] font-semibold border border-white/15 bg-white/6 text-white/70 hover:bg-white/12 hover:text-white transition-all flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white/6 disabled:hover:text-white/70"
          >
            <Undo2 className="w-3 h-3" />
            Undo
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            title="Redo (⌘⇧Z)"
            className="px-3 py-1.5 rounded-[7px] text-[11px] font-semibold border border-white/15 bg-white/6 text-white/70 hover:bg-white/12 hover:text-white transition-all flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white/6 disabled:hover:text-white/70"
          >
            <Redo2 className="w-3 h-3" />
            Redo
          </button>
          {exportError && (
            <span className="text-[10px] font-semibold text-red-300 mr-1">
              {exportError}
            </span>
          )}
          <div className="relative">
            <button
              onClick={() => setExportMenuOpen((v) => !v)}
              disabled={!canExport || exporting}
              title={canExport ? "Export drawing" : "No DWG drawing to export"}
              className="px-3 py-1.5 rounded-[7px] text-[11px] font-bold bg-white text-[#002e81] hover:bg-[#e6eeff] transition-all flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {exporting ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Download className="w-3 h-3" />
              )}
              {exporting ? "Exporting…" : "Export"}
              {changeCount > 0 && !exporting && (
                <span className="bg-[#002e81] text-white text-[9px] px-1.5 py-0.5 rounded-full font-bold">
                  {changeCount}
                </span>
              )}
            </button>
            {exportMenuOpen && (
              <>
                {/* Click-away backdrop */}
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setExportMenuOpen(false)}
                />
                <div className="absolute right-0 top-full mt-1.5 z-50 w-52 rounded-lg bg-white shadow-xl border border-gray-200 py-1 overflow-hidden">
                  <button
                    onClick={() => handleExport("bid")}
                    className="w-full px-3 py-2 text-left text-[12px] font-semibold text-gray-700 hover:bg-blue-50 hover:text-[#002e81] transition-colors flex items-center gap-2.5"
                  >
                    <Package className="w-3.5 h-3.5" />
                    <span className="flex flex-col">
                      Bid Package
                      <span className="text-[9px] font-normal text-gray-400">
                        Drawing + change summary
                      </span>
                    </span>
                  </button>
                  <div className="h-px bg-gray-100 mx-2 my-1" />
                  <button
                    onClick={() => handleExport("pdf")}
                    className="w-full px-3 py-2 text-left text-[12px] font-semibold text-gray-700 hover:bg-blue-50 hover:text-[#002e81] transition-colors flex items-center gap-2.5"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span className="flex flex-col">
                      Branded PDF
                      <span className="text-[9px] font-normal text-gray-400">
                        With title block
                      </span>
                    </span>
                  </button>
                  <button
                    onClick={() => handleExport("png")}
                    className="w-full px-3 py-2 text-left text-[12px] font-semibold text-gray-700 hover:bg-blue-50 hover:text-[#002e81] transition-colors flex items-center gap-2.5"
                  >
                    <ImageIcon className="w-3.5 h-3.5" />
                    <span className="flex flex-col">
                      PNG image
                      <span className="text-[9px] font-normal text-gray-400">
                        Drawing + markups
                      </span>
                    </span>
                  </button>
                </div>
              </>
            )}
          </div>
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
                  if (!isActive) switchSheet(idx);
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
        {/* Left drawer: component nav + embedded AI configurator.
            Collapsed entirely on P&ID (not resizable) — no empty panel. */}
        {sheetType !== "PID" && (
          <aside className="w-[340px] flex-shrink-0 flex flex-col bg-white z-20 overflow-hidden shadow-[4px_0_30px_rgba(0,0,0,0.12)]">
            <ComponentSidebar />
            {/* AI Configurator — natural language dimension modification */}
            <NLBar />
          </aside>
        )}

        {drawingType === "dwg" ? <SvgDrawingCanvas /> : <DrawingCanvas />}
      </div>
    </div>
  );
}
