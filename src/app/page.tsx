"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useProjectStore } from "@/lib/projects/store";
import { useCADStore } from "@/lib/cad/store";
import { processCADFile, processCADFileBatch } from "@/lib/cad/file-processing";
import type { BatchProcessedFile } from "@/lib/cad/file-processing";
import { useAuth } from "@/components/providers/auth-provider";
import { AIAnalysisChat } from "@/components/cad-viewer/AIAnalysisChat";
import type { CompositeAnalysis, PageSummary } from "@/types/composite";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Plus,
  FolderOpen,
  Trash2,
  Pencil,
  Clock,
  FileText,
  LogOut,
  ChevronDown,
  Upload,
  ArrowLeft,
  FileImage,
  File,
  Loader2,
  Check,
  X,
} from "lucide-react";
import Image from "next/image";

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-2 flex-1 rounded-full transition-colors ${
            i < current ? "bg-[#93C90F]" : "bg-[#D4D4D4]"
          }`}
        />
      ))}
    </div>
  );
}

// ── Processing progress types & helpers ──

type WizardPhase =
  | "creating"
  | "converting"
  | "extracting"
  | "parsing"
  | "detecting"
  | "saving"
  | "opening"
  | "done";

interface PhaseConfig {
  key: WizardPhase;
  label: string;
}

function getPhaseList(ext: string): PhaseConfig[] {
  const phases: PhaseConfig[] = [{ key: "creating", label: "Creating project" }];
  if (ext === "dwg") {
    phases.push({ key: "converting", label: "Converting DWG to DXF" });
    phases.push({ key: "parsing", label: "Parsing drawing data" });
  } else if (ext === "pdf") {
    phases.push({ key: "extracting", label: "Extracting PDF geometry" });
  } else {
    phases.push({ key: "parsing", label: "Parsing DXF file" });
  }
  phases.push({ key: "detecting", label: "Detecting components" });
  phases.push({ key: "saving", label: "Saving to project" });
  phases.push({ key: "opening", label: "Opening in viewer" });
  return phases;
}

const phaseWeights: Record<string, number> = {
  creating: 5,
  converting: 40,
  extracting: 35,
  parsing: 25,
  detecting: 15,
  saving: 5,
  opening: 5,
};

function getEstimatedTime(fileSize: number, ext: string): string {
  const sizeMB = fileSize / (1024 * 1024);
  let seconds: number;
  if (ext === "dwg") {
    seconds = Math.max(10, Math.min(60, Math.round(sizeMB * 5)));
  } else if (ext === "pdf") {
    seconds = Math.max(5, Math.min(120, Math.round(sizeMB * 8)));
  } else {
    seconds = Math.max(2, Math.min(15, Math.round(sizeMB * 2)));
  }
  if (seconds < 10) return "a few seconds";
  if (seconds < 30) return `~${seconds} seconds`;
  if (seconds < 60) return "under a minute";
  return `~${Math.round(seconds / 60)} minute${Math.round(seconds / 60) > 1 ? "s" : ""}`;
}

interface WizardFile {
  file: File;
  nickname: string;
}

/** Extract unique text labels from a drawing for AI analysis */
function extractTextLabels(drawing: { entities: Array<{ type: string; text?: string }> }): string[] {
  const labels = new Set<string>();
  for (const e of drawing.entities) {
    if ((e.type === "TEXT" || e.type === "MTEXT") && e.text) {
      const clean = e.text.trim();
      if (clean.length > 0 && clean.length < 100) {
        labels.add(clean);
      }
    }
  }
  return Array.from(labels);
}

function ProcessingProgress({
  file,
  phase,
  fileIndex,
  totalFiles,
}: {
  file: File;
  phase: WizardPhase;
  fileIndex?: number;
  totalFiles?: number;
}) {
  const ext = file.name.split(".").pop()?.toLowerCase() || "dxf";
  const phases = getPhaseList(ext);
  const store = useCADStore.getState();
  const currentIndex = phases.findIndex((p) => p.key === phase);
  const isDone = phase === "done";
  const weights = phases.map((p) => phaseWeights[p.key] || 5);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const completedWeight = weights
    .slice(0, Math.max(0, currentIndex))
    .reduce((a, b) => a + b, 0);
  const progress = isDone
    ? 100
    : Math.round((completedWeight / totalWeight) * 100);

  return (
    <div className="space-y-4">
      {/* File index header */}
      {totalFiles != null && totalFiles > 1 && fileIndex != null && (
        <div className="text-xs font-semibold text-[#999] uppercase tracking-wider">
          Processing file {fileIndex + 1} of {totalFiles}
        </div>
      )}

      {/* File info */}
      <div className="flex items-center gap-3">
        <div
          className={`w-10 h-10 rounded-lg flex items-center justify-center ${
            ext === "pdf"
              ? "bg-red-50"
              : ext === "dwg"
                ? "bg-blue-50"
                : "bg-[#93C90F]/10"
          }`}
        >
          {ext === "pdf" ? (
            <FileImage className="w-5 h-5 text-red-400" />
          ) : (
            <File
              className={`w-5 h-5 ${ext === "dwg" ? "text-blue-400" : "text-[#93C90F]"}`}
            />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-[#0C121D] truncate">
            {file.name}
          </div>
          <div className="flex items-center gap-2 text-xs text-[#999]">
            <span>{(file.size / 1024).toFixed(0)} KB</span>
            <span className="px-1.5 py-0.5 rounded bg-[#EBEBEB] text-[#666] uppercase text-[10px] font-semibold tracking-wide">
              {ext}
            </span>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-[#D4D4D4] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${
            isDone ? "bg-green-500" : "bg-[#93C90F]"
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Phase list */}
      <div className="space-y-1.5">
        {phases.map((p, i) => {
          const isComplete = i < currentIndex || isDone;
          const isActive = i === currentIndex && !isDone;
          const isPending = i > currentIndex && !isDone;

          return (
            <div
              key={p.key}
              className={`flex items-center gap-2 text-sm transition-colors ${
                isPending
                  ? "text-[#ccc]"
                  : isComplete
                    ? "text-[#999]"
                    : "text-[#0C121D] font-medium"
              }`}
            >
              {isComplete ? (
                <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
              ) : isActive ? (
                <Loader2 className="w-4 h-4 text-[#93C90F] animate-spin flex-shrink-0" />
              ) : (
                <div className="w-4 h-4 rounded-full border-2 border-[#D4D4D4] flex-shrink-0" />
              )}
              {p.label}
            </div>
          );
        })}
      </div>

      {/* Time estimate or completion summary */}
      {isDone ? (
        <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-700">
          Ready — {store.drawing?.entities.length ?? 0} entities across{" "}
          {store.drawing?.layers.length ?? 0} layers
        </div>
      ) : (
        <div className="text-xs text-[#999] text-center">
          Usually takes {getEstimatedTime(file.size, ext)} for files this size
        </div>
      )}
    </div>
  );
}

export default function StartPage() {
  const router = useRouter();
  const { profile, isLoading: authLoading, signOut } = useAuth();
  const {
    projects,
    isLoaded,
    loadProjects,
    createProject,
    openProject,
    addDrawing,
    deleteProject,
    renameProject,
  } = useProjectStore();
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  // Wizard state
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [projectName, setProjectName] = useState("");
  const [wizardFiles, setWizardFiles] = useState<WizardFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState("");
  const [wizardError, setWizardError] = useState("");
  const [processingPhase, setProcessingPhase] = useState<WizardPhase | null>(null);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // AI analysis state (step 3)
  const [batchResults, setBatchResults] = useState<BatchProcessedFile[]>([]);
  const [pageSummaries, setPageSummaries] = useState<PageSummary[]>([]);

  // Open project dialog
  const [showOpenDialog, setShowOpenDialog] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    if (!authLoading) {
      if (!profile) {
        router.replace("/login");
        return;
      }
      loadProjects();
    }
  }, [authLoading, profile, loadProjects, router]);

  const resetWizard = () => {
    setWizardStep(1);
    setProjectName("");
    setWizardFiles([]);
    setIsProcessing(false);
    setProcessingStatus("");
    setProcessingPhase(null);
    setCurrentFileIndex(0);
    setWizardError("");
    setBatchResults([]);
    setPageSummaries([]);
  };

  const handleFilesSelect = (files: FileList | File[]) => {
    const newFiles: WizardFile[] = Array.from(files).map((f) => ({
      file: f,
      nickname: f.name.replace(/\.(dxf|dwg|pdf)$/i, ""),
    }));
    setWizardFiles((prev) => [...prev, ...newFiles]);
    setWizardError("");
  };

  /** Step 2: Batch-process files and build page summaries, then advance to Step 3 */
  const handleProcessFiles = async () => {
    if (wizardFiles.length === 0) return;
    setIsProcessing(true);
    setWizardError("");
    setCurrentFileIndex(0);

    try {
      const results: BatchProcessedFile[] = [];

      // Batch process each file (without loading into store)
      for (let i = 0; i < wizardFiles.length; i++) {
        setCurrentFileIndex(i);
        const wf = wizardFiles[i];

        const result = await processCADFileBatch(wf.file, (phase) => {
          if (phase !== "done") setProcessingPhase(phase);
        });
        results.push(result);
      }

      setBatchResults(results);

      // Build page summaries for AI analysis
      const summaries: PageSummary[] = [];
      for (let fileIdx = 0; fileIdx < results.length; fileIdx++) {
        const result = results[fileIdx];
        const nickname = wizardFiles[fileIdx].nickname.trim() || result.fileName;

        if (result.isPdf && result.pageResults) {
          // Multi-page PDF — one summary per page
          for (const pageResult of result.pageResults) {
            const pageSource = `pdf:${pageResult.pageNumber}`;
            summaries.push({
              pageSource,
              drawingId: "", // Will be set after saving
              fileName: result.fileName,
              pageNumber: pageResult.pageNumber,
              components: pageResult.components.map((c) => ({
                id: c.id,
                name: c.name,
                type: c.type,
                boundingBox: c.boundingBox,
                entityCount: c.entityHandles.length,
              })),
              dimensions: pageResult.dimensions.map((d) => ({
                id: d.id,
                displayText: d.displayText,
                value: d.value,
                direction: d.direction,
                confidence: d.confidence,
              })),
              textLabels: extractTextLabels(pageResult.drawing),
              entityCount: pageResult.drawing.entities.length,
            });
          }
        } else if (result.drawing) {
          // DXF/DWG — single page
          const pageSource = `dwg:${fileIdx}`;
          summaries.push({
            pageSource,
            drawingId: "",
            fileName: result.fileName,
            pageNumber: 1,
            components: result.components.map((c) => ({
              id: c.id,
              name: c.name,
              type: c.type,
              boundingBox: c.boundingBox,
              entityCount: c.entityHandles.length,
            })),
            dimensions: result.dimensions.map((d) => ({
              id: d.id,
              displayText: d.displayText,
              value: d.value,
              direction: d.direction,
              confidence: d.confidence,
            })),
            textLabels: extractTextLabels(result.drawing),
            entityCount: result.drawing.entities.length,
          });
        }
      }

      setPageSummaries(summaries);
      setIsProcessing(false);
      setProcessingPhase(null);

      // Advance to AI analysis step
      setWizardStep(3);
    } catch (err) {
      console.error("File processing failed:", err);
      setWizardError(err instanceof Error ? err.message : "Something went wrong");
      setIsProcessing(false);
      setProcessingStatus("");
    }
  };

  /** Step 3 complete: Save drawings, open tabs, optionally store composite analysis */
  const handleFinishWizard = async (compositeAnalysis?: CompositeAnalysis) => {
    setIsProcessing(true);
    setWizardError("");

    try {
      // Create project
      setProcessingStatus("Creating project...");
      const project = await createProject(projectName.trim());

      // Save each file as a drawing and open as tab
      for (let i = 0; i < batchResults.length; i++) {
        const result = batchResults[i];
        const wf = wizardFiles[i];

        setProcessingStatus(`Saving ${wf.nickname || result.fileName}...`);
        const drawing = await addDrawing(project.id, {
          name: wf.nickname.trim() || result.fileName,
          fileName: result.fileName,
          dxfContent: result.dxfContent,
          fileSizeBytes: result.fileSize,
        });

        // Load into store via the original processCADFile (sets up viewer state correctly)
        await processCADFile(wf.file, () => {});

        // Open as tab
        useCADStore.getState().openFileAsTab(drawing.id, result.fileName, result.dxfContent);

        // Set tab label to nickname
        const tabs = useCADStore.getState().tabs;
        const newTab = tabs[tabs.length - 1];
        if (newTab && wf.nickname.trim()) {
          useCADStore.setState({
            tabs: tabs.map((t) =>
              t.id === newTab.id ? { ...t, label: wf.nickname.trim() } : t
            ),
          });
        }
      }

      // Store composite analysis if provided
      if (compositeAnalysis) {
        useCADStore.getState().setCompositeAnalysis(compositeAnalysis);

        // Store per-page dimensions from batch results
        for (const result of batchResults) {
          if (result.isPdf && result.pageResults) {
            for (const pr of result.pageResults) {
              useCADStore
                .getState()
                .storePageDimensions(`pdf:${pr.pageNumber}`, pr.dimensions);
            }
          } else if (result.dimensions) {
            const idx = batchResults.indexOf(result);
            useCADStore
              .getState()
              .storePageDimensions(`dwg:${idx}`, result.dimensions);
          }
        }
      }

      // Navigate to viewer
      openProject(project.id);
      router.push("/viewer");
    } catch (err) {
      console.error("Wizard failed:", err);
      setWizardError(err instanceof Error ? err.message : "Something went wrong");
      setIsProcessing(false);
      setProcessingStatus("");
    }
  };

  const handleOpenProject = (id: string) => {
    openProject(id);
    setShowOpenDialog(false);
    router.push("/viewer");
  };

  const handleDeleteProject = (id: string, name: string) => {
    if (confirm(`Delete "${name}"? This cannot be undone.`)) {
      deleteProject(id);
    }
  };

  const handleStartRename = (id: string, currentName: string) => {
    setRenamingId(id);
    setRenameValue(currentName);
  };

  const handleFinishRename = () => {
    if (renamingId && renameValue.trim()) {
      renameProject(renamingId, renameValue.trim());
    }
    setRenamingId(null);
    setRenameValue("");
  };

  const sortedProjects = [...projects].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  // Show loading while auth is resolving or projects haven't loaded yet
  if (authLoading || (!isLoaded && profile)) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-[#F5F5F5]">
        <Image
          src="/logo.png"
          alt="EnergyLink FLEX"
          width={706}
          height={149}
          className="mb-6 w-[320px] h-auto"
          priority
        />
        <div className="animate-pulse text-[#999] text-sm">Loading...</div>
      </div>
    );
  }

  // Auth resolved but no profile — redirect is in progress
  if (!profile) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#F5F5F5]">
        <div className="animate-pulse text-[#999] text-sm">Redirecting...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F5] flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-end px-6 py-4 gap-3">
        <span className="text-sm text-[#999]">EnergyLink FLEX v0.1.0</span>
        {profile && (
          <div className="relative">
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-[#EBEBEB] transition-colors"
            >
              {profile.avatar_url ? (
                <img src={profile.avatar_url} alt="" className="w-7 h-7 rounded-full" />
              ) : (
                <div className="w-7 h-7 rounded-full bg-[#93C90F] flex items-center justify-center text-white text-xs font-semibold">
                  {(profile.display_name || profile.email || "U")[0].toUpperCase()}
                </div>
              )}
              <span className="text-sm font-medium text-[#666] hidden sm:inline">
                {profile.display_name || profile.email}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-[#999]" />
            </button>
            {userMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-lg border border-[#D4D4D4] shadow-lg z-50 py-1">
                  <div className="px-3 py-2 border-b border-[#F0F0F0]">
                    <div className="text-sm font-medium text-[#0C121D] truncate">{profile.display_name}</div>
                    <div className="text-xs text-[#999] truncate">{profile.email}</div>
                  </div>
                  <button
                    onClick={() => { setUserMenuOpen(false); signOut(); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[#666] hover:bg-[#EBEBEB] transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Sign Out
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Center content */}
      <div className="flex-1 flex flex-col items-center justify-center pb-20">
        <Image src="/logo.png" alt="EnergyLink FLEX" width={706} height={149} className="mb-4 w-[420px] h-auto" priority />
        <div className="w-[320px] h-px bg-[#D4D4D4] mb-6" />
        <p className="text-xl text-[#666] mb-12">
          {getGreeting()}
          {profile?.display_name ? `, ${profile.display_name.split(" ")[0]}` : ""}
          {" — what are we working on?"}
        </p>

        <div className="flex gap-6">
          <button
            onClick={() => { resetWizard(); setShowWizard(true); }}
            className="w-[280px] h-[200px] bg-white rounded-2xl border border-[#D4D4D4] shadow-sm hover:border-[#93C90F] hover:shadow-lg hover:shadow-[#93C90F]/10 transition-all flex flex-col items-center justify-center gap-4 group cursor-pointer"
          >
            <div className="w-12 h-12 rounded-xl bg-[#93C90F]/10 flex items-center justify-center group-hover:bg-[#93C90F]/20 transition-colors">
              <Plus className="w-6 h-6 text-[#93C90F]" />
            </div>
            <div className="text-center">
              <div className="font-semibold text-[#0C121D] text-lg">New Project</div>
              <div className="text-sm text-[#999] mt-1">Upload a drawing and start editing</div>
            </div>
          </button>

          <button
            onClick={() => {
              if (projects.length === 0) { resetWizard(); setShowWizard(true); }
              else setShowOpenDialog(true);
            }}
            className="w-[280px] h-[200px] bg-white rounded-2xl border border-[#D4D4D4] shadow-sm hover:border-[#93C90F] hover:shadow-lg hover:shadow-[#93C90F]/10 transition-all flex flex-col items-center justify-center gap-4 group cursor-pointer"
          >
            <div className="w-12 h-12 rounded-xl bg-[#93C90F]/10 flex items-center justify-center group-hover:bg-[#93C90F]/20 transition-colors">
              <FolderOpen className="w-6 h-6 text-[#93C90F]" />
            </div>
            <div className="text-center">
              <div className="font-semibold text-[#0C121D] text-lg">Open Project</div>
              <div className="text-sm text-[#999] mt-1">Continue where you left off</div>
            </div>
          </button>
        </div>

        {/* How it works — guided steps */}
        <div className="mt-14 w-full max-w-2xl">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#999] text-center mb-4">How it works</p>
          <div className="grid grid-cols-4 gap-3">
            {[
              { num: "1", title: "Upload", desc: "DXF, DWG, or PDF drawing" },
              { num: "2", title: "AI Analyze", desc: "Auto-detect components" },
              { num: "3", title: "Edit", desc: "Click dimensions to resize" },
              { num: "4", title: "Export", desc: "Download modified drawing" },
            ].map((s) => (
              <div key={s.num} className="text-center">
                <div className="w-8 h-8 mx-auto rounded-full bg-[#93C90F]/10 text-[#93C90F] text-sm font-bold flex items-center justify-center mb-2">
                  {s.num}
                </div>
                <div className="text-sm font-medium text-[#333]">{s.title}</div>
                <div className="text-[11px] text-[#999] mt-0.5">{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center py-4 text-xs text-[#999]">
        <span>EnergyLink International</span>
        <span className="mx-2">|</span>
        <span>EnergyLink FLEX v0.1.0</span>
      </div>

      {/* ── New Project Wizard (2 steps) ── */}
      <Dialog open={showWizard} onOpenChange={(open) => { if (!isProcessing) { setShowWizard(open); if (!open) resetWizard(); } }}>
        <DialogContent className="sm:max-w-md">
          <StepIndicator current={wizardStep} total={3} />

          {/* Step 1: Project Name */}
          {wizardStep === 1 && (
            <>
              <DialogHeader>
                <DialogTitle>Name Your Project</DialogTitle>
              </DialogHeader>
              <div className="py-2">
                <p className="text-sm text-[#666] mb-3">
                  Give your project a name so you can find it later. This is typically the site name or quote reference.
                </p>
                <label className="text-sm font-medium text-[#666] mb-1 block">Project Name</label>
                <Input
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="e.g., Independence Station SCR System"
                  onKeyDown={(e) => { if (e.key === "Enter" && projectName.trim()) setWizardStep(2); }}
                  autoFocus
                />
                <p className="text-xs text-[#999] mt-2">Tip: Use the site name and system type for easy identification.</p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowWizard(false)}>Cancel</Button>
                <Button
                  onClick={() => setWizardStep(2)}
                  disabled={!projectName.trim()}
                  className="bg-[#93C90F] hover:bg-[#7AB00D] text-white"
                >
                  Next
                </Button>
              </DialogFooter>
            </>
          )}

          {/* Step 2: Upload Files */}
          {wizardStep === 2 && (
            <>
              <DialogHeader>
                <DialogTitle>Upload Project Files</DialogTitle>
              </DialogHeader>
              <div className="py-2 space-y-4">
                <p className="text-sm text-[#666]">
                  Upload the engineering drawings you want to work with. We support AutoCAD DXF/DWG and multi-page PDF files.
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".dxf,.dwg,.pdf"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      handleFilesSelect(e.target.files);
                    }
                    e.target.value = "";
                  }}
                />

                {/* Drop zone / upload button */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const files = Array.from(e.dataTransfer.files).filter((f) =>
                      /\.(dxf|dwg|pdf)$/i.test(f.name)
                    );
                    if (files.length > 0) handleFilesSelect(files);
                  }}
                  className="w-full h-24 border-2 border-dashed border-[#D4D4D4] rounded-xl hover:border-[#93C90F] hover:bg-[#93C90F]/5 transition-all flex flex-col items-center justify-center gap-1.5 group"
                >
                  <Upload className="w-6 h-6 text-[#bbb] group-hover:text-[#93C90F] transition-colors" />
                  <span className="text-sm text-[#999] group-hover:text-[#666]">
                    {wizardFiles.length === 0
                      ? "Click or drag files here (DXF, DWG, PDF)"
                      : "Add more files"}
                  </span>
                </button>

                {/* File list */}
                {wizardFiles.length > 0 && (
                  <div className="space-y-2 max-h-[240px] overflow-y-auto">
                    {wizardFiles.map((wf, idx) => {
                      const ext = wf.file.name.split(".").pop()?.toLowerCase() || "";
                      return (
                        <div
                          key={idx}
                          className="p-3 rounded-lg border border-[#D4D4D4] bg-[#FAFAFA] space-y-2"
                        >
                          <div className="flex items-center gap-3">
                            {ext === "pdf" ? (
                              <FileImage className="w-5 h-5 text-red-400 flex-shrink-0" />
                            ) : (
                              <File
                                className={`w-5 h-5 flex-shrink-0 ${ext === "dwg" ? "text-blue-400" : "text-[#93C90F]"}`}
                              />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium text-[#0C121D] truncate">
                                {wf.file.name}
                              </div>
                              <div className="flex items-center gap-2 text-xs text-[#999]">
                                <span>{(wf.file.size / 1024).toFixed(0)} KB</span>
                                <span className="px-1.5 py-0.5 rounded bg-[#EBEBEB] text-[#666] uppercase text-[10px] font-semibold tracking-wide">
                                  {ext}
                                </span>
                              </div>
                            </div>
                            <button
                              onClick={() =>
                                setWizardFiles((prev) =>
                                  prev.filter((_, i) => i !== idx)
                                )
                              }
                              className="p-1 rounded hover:bg-red-50 text-[#999] hover:text-red-500 transition-colors"
                              title="Remove file"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                          <Input
                            value={wf.nickname}
                            onChange={(e) =>
                              setWizardFiles((prev) =>
                                prev.map((f, i) =>
                                  i === idx
                                    ? { ...f, nickname: e.target.value }
                                    : f
                                )
                              )
                            }
                            placeholder="Drawing nickname"
                            className="h-8 text-sm"
                          />
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Processing progress */}
                {isProcessing && processingPhase && wizardFiles[currentFileIndex] && (
                  <ProcessingProgress
                    file={wizardFiles[currentFileIndex].file}
                    phase={processingPhase}
                    fileIndex={currentFileIndex}
                    totalFiles={wizardFiles.length}
                  />
                )}

                {wizardError && (
                  <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-600">
                    {wizardError}
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setWizardStep(1)} disabled={isProcessing}>
                  <ArrowLeft className="w-4 h-4 mr-1" /> Back
                </Button>
                <Button
                  onClick={handleProcessFiles}
                  disabled={wizardFiles.length === 0 || isProcessing}
                  className="bg-[#93C90F] hover:bg-[#7AB00D] text-white"
                >
                  {isProcessing ? (
                    <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Processing...</>
                  ) : (
                    "Next"
                  )}
                </Button>
              </DialogFooter>
            </>
          )}

          {/* Step 3: AI Composite Analysis */}
          {wizardStep === 3 && (
            <>
              <DialogHeader>
                <DialogTitle>AI Drawing Analysis</DialogTitle>
              </DialogHeader>
              <div className="py-2">
                <p className="text-sm text-[#666] mb-3">
                  AI will analyze your drawings to identify components (stacks, ducts, silencers) and link related dimensions across pages. You can skip this and run it later from the toolbar.
                </p>
                {isProcessing ? (
                  <div className="flex items-center gap-3 p-4">
                    <Loader2 className="w-5 h-5 text-[#93C90F] animate-spin" />
                    <span className="text-sm text-[#666]">{processingStatus || "Saving project..."}</span>
                  </div>
                ) : (
                  <AIAnalysisChat
                    pageSummaries={pageSummaries}
                    onComplete={(analysis) => handleFinishWizard(analysis)}
                    onSkip={() => handleFinishWizard()}
                  />
                )}

                {wizardError && (
                  <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-600 mt-3">
                    {wizardError}
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => handleFinishWizard()}
                  disabled={isProcessing}
                >
                  Skip Analysis
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Open Project Dialog ── */}
      <Dialog open={showOpenDialog} onOpenChange={setShowOpenDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Open Project</DialogTitle>
          </DialogHeader>
          <div className="py-2 max-h-[400px] overflow-y-auto">
            {sortedProjects.length === 0 ? (
              <p className="text-center text-[#999] py-8">No projects yet. Create one to get started.</p>
            ) : (
              <div className="grid gap-2">
                {sortedProjects.map((project) => (
                  <div
                    key={project.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-[#D4D4D4] hover:border-[#93C90F]/40 hover:bg-[#93C90F]/5 transition-all cursor-pointer group"
                    onClick={() => handleOpenProject(project.id)}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 bg-[#EBEBEB] rounded-lg flex items-center justify-center flex-shrink-0 group-hover:bg-[#93C90F]/10">
                        <FileText className="w-4 h-4 text-[#999] group-hover:text-[#93C90F]" />
                      </div>
                      <div className="min-w-0">
                        {renamingId === project.id ? (
                          <Input
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={handleFinishRename}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleFinishRename();
                              if (e.key === "Escape") { setRenamingId(null); setRenameValue(""); }
                            }}
                            className="h-7 text-sm font-medium"
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <h3 className="font-medium text-[#0C121D] truncate text-sm">{project.name}</h3>
                        )}
                        <div className="flex items-center gap-3 text-xs text-[#999] mt-0.5">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {timeAgo(project.updatedAt)}
                          </span>
                          <span>{project.drawings.length} drawing{project.drawings.length !== 1 ? "s" : ""}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        className="p-1.5 rounded hover:bg-[#EBEBEB] text-[#999] hover:text-[#666]"
                        onClick={(e) => { e.stopPropagation(); handleStartRename(project.id, project.name); }}
                        title="Rename"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        className="p-1.5 rounded hover:bg-red-50 text-[#999] hover:text-red-500"
                        onClick={(e) => { e.stopPropagation(); handleDeleteProject(project.id, project.name); }}
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
