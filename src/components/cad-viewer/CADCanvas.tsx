"use client";

import { useEffect, useRef, useCallback } from "react";
import { CADRenderer } from "@/lib/cad/renderer";
import { useCADStore } from "@/lib/cad/store";

export function CADCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<CADRenderer | null>(null);
  const {
    drawing,
    selectedComponentId,
    hoveredComponentId,
    selectComponent,
    hoverComponent,
  } = useCADStore();

  // Initialize renderer
  useEffect(() => {
    if (!containerRef.current) return;

    const renderer = new CADRenderer();
    renderer.mount(containerRef.current);
    rendererRef.current = renderer;

    return () => {
      renderer.unmount();
      rendererRef.current = null;
    };
  }, []);

  // Load drawing when it changes
  useEffect(() => {
    if (!rendererRef.current || !drawing) return;
    rendererRef.current.loadDrawing(drawing);
  }, [drawing]);

  // Update highlights
  useEffect(() => {
    if (!rendererRef.current) return;
    if (selectedComponentId) {
      rendererRef.current.highlightComponent(selectedComponentId, "#FFD700");
    } else if (hoveredComponentId) {
      rendererRef.current.highlightComponent(hoveredComponentId, "#4A90D9");
    } else {
      rendererRef.current.highlightComponent(null);
    }
  }, [selectedComponentId, hoveredComponentId]);

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      if (!rendererRef.current || !drawing) return;
      // Don't select on shift+click (that's pan)
      if (event.shiftKey) return;

      const componentId = rendererRef.current.getComponentAtPoint(
        event.clientX,
        event.clientY
      );
      selectComponent(componentId);
    },
    [drawing, selectComponent]
  );

  const handleMouseMove = useCallback(
    (event: React.MouseEvent) => {
      if (!rendererRef.current || !drawing) return;
      if (event.shiftKey) return; // Panning

      const componentId = rendererRef.current.getComponentAtPoint(
        event.clientX,
        event.clientY
      );
      hoverComponent(componentId);
    },
    [drawing, hoverComponent]
  );

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative cursor-crosshair"
      onClick={handleClick}
      onMouseMove={handleMouseMove}
    >
      {!drawing && (
        <div className="absolute inset-0 flex items-center justify-center text-[#888]">
          <div className="text-center">
            <p className="text-lg font-medium text-[#555]">No drawing loaded</p>
            <p className="text-sm mt-1">Upload a DXF file to get started</p>
          </div>
        </div>
      )}
    </div>
  );
}
