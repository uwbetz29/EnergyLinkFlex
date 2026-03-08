"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CADCanvas } from "@/components/cad-viewer/CADCanvas";
import { ComponentPanel } from "@/components/cad-viewer/ComponentPanel";
import { Toolbar } from "@/components/cad-viewer/Toolbar";
import { LayerPanel } from "@/components/cad-viewer/LayerPanel";
import { ProjectDrawer } from "@/components/layout/ProjectDrawer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useProjectStore } from "@/lib/projects/store";

export default function ViewerPage() {
  const router = useRouter();
  const [showLayers, setShowLayers] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { currentProjectId, isLoaded, loadFromStorage, getCurrentProject } =
    useProjectStore();

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

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
        <div className="animate-pulse text-[#888]">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-white text-[#222]">
      {/* Toolbar */}
      <Toolbar
        onToggleLayers={() => setShowLayers(!showLayers)}
        showLayers={showLayers}
        onMenuClick={() => setDrawerOpen(true)}
        projectName={project?.name}
      />

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* CAD Canvas — takes remaining space */}
        <div className="flex-1 relative">
          <CADCanvas />
        </div>

        {/* Layer panel (optional) */}
        {showLayers && <LayerPanel />}

        {/* Component/Scale panel — right sidebar */}
        <div className="w-72 border-l border-[#E7E7E7] bg-[#F7F9FA]">
          <ScrollArea className="h-full">
            <ComponentPanel />
          </ScrollArea>
        </div>
      </div>

      {/* Status bar */}
      <div className="h-6 bg-[#F6F6F6] border-t border-[#E7E7E7] flex items-center px-3 text-[10px] text-[#888]">
        <span>EnergyLinkage v0.1.0</span>
        <span className="mx-2">|</span>
        <span>Shift+Click to pan, Scroll to zoom</span>
      </div>

      {/* Project drawer */}
      <ProjectDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
    </div>
  );
}
