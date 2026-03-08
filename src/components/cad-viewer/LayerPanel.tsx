"use client";

import { useCADStore } from "@/lib/cad/store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Eye, EyeOff } from "lucide-react";

export function LayerPanel() {
  const { drawing, layerVisibility, toggleLayerVisibility } = useCADStore();

  if (!drawing) return null;

  const sortedLayers = [...drawing.layers].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  return (
    <div className="w-56 border-l border-[#E7E7E7] bg-[#F7F9FA]">
      <div className="p-3 border-b border-[#E7E7E7]">
        <h3 className="text-xs font-medium text-[#555]">
          Layers ({sortedLayers.length})
        </h3>
      </div>
      <ScrollArea className="h-full">
        <div className="p-2 space-y-0.5">
          {sortedLayers.map((layer) => {
            const isVisible = layerVisibility[layer.name] !== false;
            return (
              <button
                key={layer.name}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-[#EDEDF0] transition-colors"
                onClick={() => toggleLayerVisibility(layer.name)}
              >
                {isVisible ? (
                  <Eye className="w-3 h-3 text-[#555]" />
                ) : (
                  <EyeOff className="w-3 h-3 text-[#bbb]" />
                )}
                <span
                  className={
                    isVisible ? "text-[#333]" : "text-[#bbb] line-through"
                  }
                >
                  {layer.name}
                </span>
                <span className="ml-auto text-[#999]">
                  {layer.entityCount}
                </span>
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
