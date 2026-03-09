"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CADCanvas } from "@/components/cad-viewer/CADCanvas";
import { Toolbar } from "@/components/cad-viewer/Toolbar";
import { ViewerSidebar } from "@/components/layout/ViewerSidebar";
import { CompositeIndicator } from "@/components/cad-viewer/CompositeIndicator";
import { useProjectStore } from "@/lib/projects/store";
import { useCADStore } from "@/lib/cad/store";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { OnboardingOverlay } from "@/components/cad-viewer/OnboardingCoach";

export default function ViewerPage() {
  const router = useRouter();
  const [showSidebar, setShowSidebar] = useState(true);
  const { currentProjectId, isLoaded, loadProjects, getCurrentProject } =
    useProjectStore();

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // Redirect to start page if no project is selected
  useEffect(() => {
    if (isLoaded && !currentProjectId) {
      router.push("/");
    }
  }, [isLoaded, currentProjectId, router]);

  const project = getCurrentProject();

  if (!isLoaded || !currentProjectId) {
    return (
      <div className="h-screen flex items-center justify-center bg-white">
        <div className="animate-pulse text-[#999]">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-white text-[#0C121D]">
      {/* Toolbar */}
      <Toolbar
        onToggleSidebar={() => setShowSidebar(!showSidebar)}
        showSidebar={showSidebar}
        projectName={project?.name}
      />

      {/* PDF page tabs + composite indicator */}
      <PDFPageTabs />
      <CompositeBar />

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar — file info + export */}
        {showSidebar && <ViewerSidebar />}

        {/* CAD Canvas */}
        <div className="flex-1 relative">
          <CADCanvas />
        </div>
      </div>

      {/* Status bar */}
      <StatusBar />

      {/* First-time onboarding */}
      <OnboardingOverlay />
    </div>
  );
}

function PDFPageTabs() {
  const { pdfPageCount, pdfCurrentPage, setPDFPage, drawing } = useCADStore();

  if (pdfPageCount <= 1) return null;

  return (
    <div className="h-9 bg-[#F0F0F0] border-b border-[#D4D4D4] flex items-end px-3 gap-0.5">
      {Array.from({ length: pdfPageCount }, (_, i) => i + 1).map((page) => (
        <button
          key={page}
          onClick={() => setPDFPage(page)}
          className={`px-4 py-1.5 text-xs font-medium rounded-t-md border border-b-0 transition-colors
            ${page === pdfCurrentPage
              ? "bg-white text-[#0C121D] border-[#D4D4D4] shadow-sm -mb-px z-10"
              : "bg-[#E5E5E5] text-[#999] border-transparent hover:bg-[#DEDEDE] hover:text-[#666]"
            }`}
        >
          Page {page}
        </button>
      ))}
      <div className="flex-1" />
      <span className="text-[10px] text-[#666] pb-1.5">
        {drawing?.entities.length ?? 0} entities on this page
      </span>
    </div>
  );
}

function CompositeBar() {
  const { compositeAnalysis } = useCADStore();
  if (!compositeAnalysis) return null;

  return (
    <div className="h-8 bg-[#FAFAFA] border-b border-[#D4D4D4] flex items-center px-3">
      <CompositeIndicator />
    </div>
  );
}

function StatusBar() {
  const { pdfPageCount, pdfCurrentPage, setPDFPage, drawing } = useCADStore();

  return (
    <div className="h-7 bg-[#F0F0F0] border-t border-[#D4D4D4] flex items-center px-3 text-[10px] text-[#999]">
      <span>EnergyLink FLEX v0.1.0</span>
      <span className="mx-2">|</span>
      <span>Drag to pan | Scroll to zoom | Click dimension labels to edit</span>

      {/* PDF page navigation */}
      {pdfPageCount > 1 && (
        <>
          <span className="mx-2">|</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPDFPage(pdfCurrentPage - 1)}
              disabled={pdfCurrentPage <= 1}
              className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-[#DEDEDE] disabled:opacity-30 disabled:pointer-events-none transition-colors"
              title="Previous page"
            >
              <ChevronLeft className="w-3 h-3" />
            </button>
            <span className="text-[#0C121D] font-medium tabular-nums min-w-[60px] text-center">
              Page {pdfCurrentPage} / {pdfPageCount}
            </span>
            <button
              onClick={() => setPDFPage(pdfCurrentPage + 1)}
              disabled={pdfCurrentPage >= pdfPageCount}
              className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-[#DEDEDE] disabled:opacity-30 disabled:pointer-events-none transition-colors"
              title="Next page"
            >
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </>
      )}

      {/* Entity count */}
      {drawing && (
        <>
          <div className="flex-1" />
          <span>{drawing.entities.length} entities</span>
        </>
      )}
    </div>
  );
}
