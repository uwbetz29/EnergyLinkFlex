"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { CADRenderer } from "@/lib/cad/renderer";
import { useCADStore } from "@/lib/cad/store";
import { DimensionOverlay } from "./DimensionOverlay";
import { IntentBar } from "./IntentBar";
import { ContextualHints, EmptyCanvasGuide, WorkflowBar } from "./OnboardingCoach";

export function CADCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<CADRenderer | null>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const [rendererReady, setRendererReady] = useState<CADRenderer | null>(null);
  /** Track which file+page is loaded to distinguish new content vs in-place update */
  const loadedKeyRef = useRef<string | null>(null);
  const {
    drawing,
    selectedComponentId,
    hoveredComponentId,
    selectComponent,
    hoverComponent,
    pdfCurrentPage,
    lastModification,
    showComponentOverlay,
    componentGraph,
    showDiff,
    originalDrawingSnapshot,
    dimensions,
  } = useCADStore();

  // Initialize renderer
  useEffect(() => {
    if (!containerRef.current) return;

    const renderer = new CADRenderer();
    renderer.mount(containerRef.current);
    rendererRef.current = renderer;
    setRendererReady(renderer);

    // Set up minimap updates on view change
    renderer.onViewChange(() => {
      if (minimapRef.current) {
        renderer.renderMinimap(minimapRef.current);
      }
    });

    return () => {
      renderer.unmount();
      rendererRef.current = null;
      setRendererReady(null);
    };
  }, []);

  // Load or update drawing when it changes
  useEffect(() => {
    if (!rendererRef.current || !drawing) return;

    // Key includes fileName + page so page switches trigger fitToView
    const drawingKey = `${drawing.fileName}::p${pdfCurrentPage}`;
    const isNewContent = drawingKey !== loadedKeyRef.current;
    loadedKeyRef.current = drawingKey;

    if (isNewContent) {
      // New file or page change — full load with fitToView
      rendererRef.current.loadDrawing(drawing);
    } else {
      // Same file+page, updated entities (e.g. dimension edit) — preserve camera
      rendererRef.current.updateDrawing(drawing);
    }

    // Render minimap
    if (minimapRef.current) {
      rendererRef.current.renderMinimap(minimapRef.current);
    }
  }, [drawing, pdfCurrentPage]);

  // Flash affected entities after dimension change
  useEffect(() => {
    if (!rendererRef.current || !lastModification) return;
    // Delay to let updateDrawing rebuild the scene first (can take 50-100ms for large drawings)
    const timer = setTimeout(() => {
      rendererRef.current?.flashEntities(lastModification.affectedEntities);
    }, 150);
    return () => clearTimeout(timer);
  }, [lastModification]);

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

  // Component bounding box overlay (Feature 1)
  useEffect(() => {
    if (!rendererRef.current) return;
    if (showComponentOverlay && componentGraph && componentGraph.components.length > 0) {
      // Delay slightly to ensure drawing is loaded
      const timer = setTimeout(() => {
        rendererRef.current?.showComponentBoxes(componentGraph.components);
      }, 100);
      return () => clearTimeout(timer);
    } else {
      rendererRef.current.clearComponentBoxes();
    }
  }, [showComponentOverlay, componentGraph, drawing]);

  // Visual diff overlay (Feature 3)
  useEffect(() => {
    if (!rendererRef.current) return;
    if (showDiff && originalDrawingSnapshot && drawing) {
      rendererRef.current.showDiffOverlay(originalDrawingSnapshot.entities, drawing.entities);
    } else {
      rendererRef.current.clearDiffOverlay();
    }
  }, [showDiff, originalDrawingSnapshot, drawing]);

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      if (!rendererRef.current || !drawing) return;
      // If user just finished dragging, don't select
      if (rendererRef.current.didPan()) return;

      const componentId = rendererRef.current.getComponentAtPoint(
        event.clientX,
        event.clientY
      );
      selectComponent(componentId);
    },
    [drawing, selectComponent]
  );

  const handleMinimapClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (!rendererRef.current || !minimapRef.current || !drawing) return;
      const rect = minimapRef.current.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * minimapRef.current.width;
      const y = ((event.clientY - rect.top) / rect.height) * minimapRef.current.height;
      const world = rendererRef.current.minimapToWorld(x, y, minimapRef.current);
      rendererRef.current.panTo(world.x, world.y);
    },
    [drawing]
  );

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative cursor-grab active:cursor-grabbing"
      onClick={handleClick}
    >
      {!drawing && <EmptyCanvasGuide />}

      {/* Contextual hints — guide users to the next step */}
      {drawing && <ContextualHints />}

      {/* Dimension overlay — clickable dimension labels */}
      {drawing && <DimensionOverlay renderer={rendererReady} />}

      {/* Workflow suggestion bar */}
      <WorkflowBar />

      {/* Intent-based editing bar (Feature 6) */}
      {drawing && dimensions.length > 0 && <IntentBar />}

      {/* Minimap */}
      {drawing && (
        <div className="absolute bottom-3 left-3 z-10">
          <canvas
            ref={minimapRef}
            width={200}
            height={150}
            className="rounded-lg border border-[#D4D4D4] shadow-md bg-white cursor-pointer"
            onClick={handleMinimapClick}
          />
        </div>
      )}
    </div>
  );
}
