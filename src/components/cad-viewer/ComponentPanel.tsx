"use client";

import { useState } from "react";
import { useCADStore } from "@/lib/cad/store";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Ruler,
  Percent,
  Link2,
  Unlink,
  RotateCcw,
  ArrowUpDown,
  ArrowLeftRight,
} from "lucide-react";

export function ComponentPanel() {
  const {
    drawing,
    selectedComponentId,
    scaleMode,
    setScaleMode,
    applyScale,
    undo,
    scaleHistory,
  } = useCADStore();

  const [scalePercent, setScalePercent] = useState("100");
  const [newDimValue, setNewDimValue] = useState("");
  const [selectedDimId, setSelectedDimId] = useState<string | null>(null);
  const [uniformScale, setUniformScale] = useState(true);

  const component = drawing?.components.find(
    (c) => c.id === selectedComponentId
  );

  if (!selectedComponentId || !component) {
    return (
      <div className="p-4 text-[#888] text-sm">
        <p className="font-medium text-[#555] mb-2">Component Panel</p>
        <p>Click on a component in the drawing to select it and view its properties.</p>
        {drawing && drawing.components.length > 0 && (
          <div className="mt-4">
            <p className="text-[#555] font-medium mb-2">
              Detected Components ({drawing.components.length})
            </p>
            <div className="space-y-1">
              {drawing.components.map((comp) => (
                <button
                  key={comp.id}
                  className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-[#F0F0F0] transition-colors flex items-center gap-2"
                  onClick={() => useCADStore.getState().selectComponent(comp.id)}
                >
                  <span
                    className="w-3 h-3 rounded-sm"
                    style={{ backgroundColor: comp.color }}
                  />
                  <span className="text-[#333]">{comp.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  const handlePercentScale = () => {
    const percent = parseFloat(scalePercent);
    if (isNaN(percent) || percent <= 0) return;
    applyScale({
      componentId: selectedComponentId,
      scaleType: "percentage",
      scalePercent: percent,
      uniformScale,
    });
  };

  const handleDimensionScale = () => {
    if (!selectedDimId || !newDimValue) return;
    applyScale({
      componentId: selectedComponentId,
      scaleType: "dimension",
      dimensionId: selectedDimId,
      newDimensionValue: newDimValue,
      uniformScale,
    });
  };

  return (
    <div className="p-4 space-y-4">
      {/* Component header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span
            className="w-3 h-3 rounded-sm"
            style={{ backgroundColor: component.color }}
          />
          <h3 className="font-semibold text-[#222]">{component.name}</h3>
        </div>
        <Badge variant="outline" className="text-xs">
          {component.type}
        </Badge>
        <p className="text-xs text-[#888] mt-1">Layer: {component.layerName}</p>
      </div>

      <Separator />

      {/* Current dimensions */}
      {component.dimensions.length > 0 && (
        <div>
          <p className="text-xs text-[#555] font-medium mb-2">
            Current Dimensions
          </p>
          <div className="space-y-1.5">
            {component.dimensions.map((dim) => (
              <button
                key={dim.id}
                className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center gap-2 transition-colors ${
                  selectedDimId === dim.id
                    ? "bg-[#93C90F]/10 text-[#5a7d00]"
                    : "hover:bg-[#F0F0F0] text-[#333]"
                }`}
                onClick={() => {
                  setSelectedDimId(dim.id);
                  setNewDimValue(dim.displayValue);
                }}
              >
                {dim.direction === "vertical" ? (
                  <ArrowUpDown className="w-3 h-3" />
                ) : (
                  <ArrowLeftRight className="w-3 h-3" />
                )}
                <span className="font-mono">{dim.displayValue}</span>
                <span className="text-[#888] ml-auto">{dim.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <Separator />

      {/* Scale mode toggle */}
      <div className="flex items-center justify-between">
        <Label className="text-xs text-[#555]">Scale Mode</Label>
        <div className="flex items-center gap-2">
          <button
            className={`p-1.5 rounded ${
              scaleMode === "linked"
                ? "bg-[#93C90F]/15 text-[#5a7d00]"
                : "text-[#888] hover:text-[#333]"
            }`}
            onClick={() => setScaleMode("linked")}
            title="Linked: neighbors adjust"
          >
            <Link2 className="w-4 h-4" />
          </button>
          <button
            className={`p-1.5 rounded ${
              scaleMode === "isolated"
                ? "bg-[#00BFDD]/15 text-[#008fa5]"
                : "text-[#888] hover:text-[#333]"
            }`}
            onClick={() => setScaleMode("isolated")}
            title="Isolated: only this component changes"
          >
            <Unlink className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Uniform scale toggle */}
      <div className="flex items-center justify-between">
        <Label className="text-xs text-[#555]">Uniform Scale</Label>
        <Switch
          checked={uniformScale}
          onCheckedChange={setUniformScale}
        />
      </div>

      <Separator />

      {/* Scaling controls */}
      <Tabs defaultValue="percent" className="w-full">
        <TabsList className="grid w-full grid-cols-2 h-8">
          <TabsTrigger value="percent" className="text-xs gap-1">
            <Percent className="w-3 h-3" /> Percentage
          </TabsTrigger>
          <TabsTrigger value="dimension" className="text-xs gap-1">
            <Ruler className="w-3 h-3" /> Dimension
          </TabsTrigger>
        </TabsList>

        <TabsContent value="percent" className="space-y-3 mt-3">
          <div>
            <Label className="text-xs text-[#555]">Scale Percentage</Label>
            <div className="flex gap-2 mt-1">
              <Input
                type="number"
                value={scalePercent}
                onChange={(e) => setScalePercent(e.target.value)}
                className="h-8 text-sm font-mono"
                min="1"
                max="500"
              />
              <span className="text-[#888] text-sm self-center">%</span>
            </div>
            <div className="flex gap-1 mt-2">
              {[75, 90, 100, 110, 125, 150].map((pct) => (
                <button
                  key={pct}
                  className="px-2 py-1 text-xs rounded bg-[#F0F0F0] hover:bg-[#E7E7E7] text-[#333]"
                  onClick={() => setScalePercent(String(pct))}
                >
                  {pct}%
                </button>
              ))}
            </div>
          </div>
          <Button
            size="sm"
            className="w-full"
            onClick={handlePercentScale}
          >
            Apply Scale
          </Button>
        </TabsContent>

        <TabsContent value="dimension" className="space-y-3 mt-3">
          <div>
            <Label className="text-xs text-[#555]">
              {selectedDimId
                ? "New Dimension Value"
                : "Select a dimension above first"}
            </Label>
            <Input
              value={newDimValue}
              onChange={(e) => setNewDimValue(e.target.value)}
              placeholder="e.g., 45'-0&quot;"
              className="h-8 text-sm font-mono mt-1"
              disabled={!selectedDimId}
            />
          </div>
          <Button
            size="sm"
            className="w-full"
            onClick={handleDimensionScale}
            disabled={!selectedDimId || !newDimValue}
          >
            Apply New Dimension
          </Button>
        </TabsContent>
      </Tabs>

      <Separator />

      {/* History / Undo */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-[#888]">
          {scaleHistory.length} operation{scaleHistory.length !== 1 ? "s" : ""}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={undo}
          disabled={scaleHistory.length === 0}
          className="h-7 text-xs gap-1"
        >
          <RotateCcw className="w-3 h-3" />
          Undo
        </Button>
      </div>
    </div>
  );
}
