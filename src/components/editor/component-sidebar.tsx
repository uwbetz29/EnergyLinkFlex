"use client";

import { useEditorStore } from "@/stores/editor-store";
import { Check, AlertTriangle, ChevronUp, RotateCcw, Ruler, Eye, EyeOff } from "lucide-react";

/** Better labels for DWG dimension keys */
const DIM_LABELS: Record<string, string> = {
  "X Scale": "Width (scale)",
  "Y Scale": "Height (scale)",
  "Z Scale": "Depth (scale)",
  "X Position": "X Position",
  "Y Position": "Y Position",
  Rotation: "Rotation",
  Height: "Height",
  Width: "Width",
};

/** Dims to hide from the sales sidebar (not user-editable) */
const HIDDEN_DIMS = new Set(["X Position", "Y Position", "Z Scale"]);

/** Get display-friendly label for a dim key */
function dimLabel(key: string): string {
  return DIM_LABELS[key] || key;
}

/** Check if a dim should be shown in the sales sidebar */
function isEditableDim(key: string): boolean {
  return !HIDDEN_DIMS.has(key);
}

export function ComponentSidebar() {
  const {
    components,
    selectedId,
    originals,
    changeCount,
    hiddenComponents,
    select,
    updateDim,
    quickAdjust,
    resetComp,
    toggleComponentVisibility,
    showAllComponents,
  } = useEditorStore();

  const selected = selectedId ? components[selectedId] : null;
  const compList = Object.values(components);
  const visibleList = compList.filter((c) => !hiddenComponents.has(c.id));
  const hiddenCount = hiddenComponents.size;
  const compOriginals = selectedId ? originals[selectedId] : undefined;

  return (
    <div className="flex-1 min-h-0 bg-white flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-[18px] py-3.5 border-b border-[rgba(0,60,160,0.08)] flex items-center justify-between bg-[#fafbfd]">
        <span className="text-[11px] font-bold text-[#a5b8d4] uppercase tracking-[0.8px]">
          {selected ? selected.name : `Components — ${visibleList.length} Shown`}
        </span>
        <div className="flex items-center gap-1.5">
          {selected && (
            <button
              onClick={() => select(null)}
              className="w-[26px] h-[26px] rounded-[7px] flex items-center justify-center
                         text-[#a5b8d4] hover:bg-[#e6eeff] hover:text-[#002e81] transition-colors text-sm"
            >
              ✕
            </button>
          )}
          {!selected && hiddenCount > 0 && (
            <button
              onClick={showAllComponents}
              className="text-[10px] font-semibold px-2 py-0.5 rounded-full
                         border border-[rgba(0,60,160,0.12)] text-[#a5b8d4]
                         hover:bg-[#e6eeff] hover:text-[#002e81] transition-colors"
            >
              Show all ({hiddenCount} hidden)
            </button>
          )}
          {!selected && changeCount > 0 && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#002e81] text-white">
              {changeCount} change{changeCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {selected ? (
          <SelectedDetail
            comp={selected}
            originals={compOriginals}
            onDimChange={(key, val) => updateDim(selected.id, key, val)}
            onQuickAdjust={(delta) => quickAdjust(selected.id, delta)}
            onReset={() => resetComp(selected.id)}
            onSelectDownstream={(id) => select(id)}
            components={components}
          />
        ) : (
          <ComponentList
            components={compList}
            hiddenComponents={hiddenComponents}
            onSelect={(id) => select(id)}
            onToggleVisibility={toggleComponentVisibility}
          />
        )}
      </div>
    </div>
  );
}

/* ─── Component List ─── */

/** Categorize components for grouping in the sidebar */
function categorizeComponent(name: string): string {
  const n = name.toUpperCase();
  if (n.startsWith("NOZZLE") || n.startsWith("N")) return "Nozzles";
  if (n.includes("PORT")) return "Ports";
  if (n.includes("GRID") || n.includes("DIST")) return "Internals";
  if (n.includes("FRAME") || n.includes("CATALYST")) return "Structure";
  if (n.includes("DUCT") || n.includes("AIR") || n.includes("OUTLET") || n.includes("TURBINE")) return "Flow Path";
  return "Other";
}

function ComponentList({
  components,
  hiddenComponents,
  onSelect,
  onToggleVisibility,
}: {
  components: { id: string; name: string; color: string; dims: Record<string, string>; mainDim: string }[];
  hiddenComponents: Set<string>;
  onSelect: (id: string) => void;
  onToggleVisibility: (id: string) => void;
}) {
  // Group components by category
  const groups: Record<string, typeof components> = {};
  for (const c of components) {
    const cat = categorizeComponent(c.name);
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(c);
  }

  // Order: Flow Path, Internals, Structure, Ports, Nozzles, Other
  const categoryOrder = ["Flow Path", "Internals", "Structure", "Ports", "Nozzles", "Other"];
  const sortedCategories = categoryOrder.filter((cat) => groups[cat]?.length);

  return (
    <div>
      {sortedCategories.map((category) => {
        const items = groups[category];
        const allHidden = items.every((c) => hiddenComponents.has(c.id));
        const someHidden = items.some((c) => hiddenComponents.has(c.id));

        return (
          <div key={category}>
            {/* Category header */}
            <div className="flex items-center px-[18px] py-2 bg-[#f5f7fa] border-b border-[rgba(0,60,160,0.05)]">
              <span className="text-[10px] font-bold text-[#a5b8d4] uppercase tracking-[0.8px] flex-1">
                {category}
                <span className="ml-1.5 text-[#c5d0e0] font-medium normal-case">
                  ({items.filter((c) => !hiddenComponents.has(c.id)).length}/{items.length})
                </span>
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  // Toggle all in this category
                  for (const c of items) {
                    if (allHidden) {
                      // Show all: only toggle hidden ones
                      if (hiddenComponents.has(c.id)) onToggleVisibility(c.id);
                    } else {
                      // Hide all: only toggle visible ones
                      if (!hiddenComponents.has(c.id)) onToggleVisibility(c.id);
                    }
                  }
                }}
                className="p-1 rounded text-[#a5b8d4] hover:text-[#002e81] hover:bg-[#e6eeff] transition-colors"
                title={allHidden ? `Show all ${category}` : `Hide all ${category}`}
              >
                {allHidden ? <EyeOff className="w-3 h-3" /> : someHidden ? <Eye className="w-3 h-3 opacity-50" /> : <Eye className="w-3 h-3" />}
              </button>
            </div>

            {/* Component items */}
            {items.map((c) => {
              const isHidden = hiddenComponents.has(c.id);
              return (
                <div
                  key={c.id}
                  className={`flex items-center gap-1.5 px-[18px] py-2 text-left
                             border-b border-[rgba(0,60,160,0.03)] transition-colors
                             ${isHidden ? "opacity-40" : "hover:bg-[#eef3ff]"}`}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleVisibility(c.id);
                    }}
                    className="w-5 h-5 flex items-center justify-center rounded
                               text-[#a5b8d4] hover:text-[#002e81] hover:bg-[#e6eeff]
                               transition-colors flex-shrink-0"
                    title={isHidden ? "Show component" : "Hide component"}
                  >
                    {isHidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  </button>
                  <button
                    onClick={() => !isHidden && onSelect(c.id)}
                    className={`flex items-center gap-2 flex-1 min-w-0 ${isHidden ? "cursor-default" : "cursor-pointer"}`}
                  >
                    <div
                      className="w-2 h-2 rounded-sm flex-shrink-0"
                      style={{ background: isHidden ? "#ccc" : c.color }}
                    />
                    <span className={`text-[12px] font-semibold flex-1 truncate text-left ${isHidden ? "text-[#a5b8d4]" : "text-[#001a4d]"}`}>
                      {c.name}
                    </span>
                    {!isHidden && (
                      <span className="text-[10px] text-[#a5b8d4] font-medium flex-shrink-0">
                        {c.dims[c.mainDim]}
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/* ─── Selected Detail ─── */

function SelectedDetail({
  comp,
  originals,
  onDimChange,
  onQuickAdjust,
  onReset,
  onSelectDownstream,
  components,
}: {
  comp: any;
  originals?: Record<string, string>;
  onDimChange: (key: string, val: string) => void;
  onQuickAdjust: (delta: number) => void;
  onReset: () => void;
  onSelectDownstream: (id: string) => void;
  components: Record<string, any>;
}) {
  const hasChanges = originals && Object.keys(originals).length > 0;

  return (
    <>
      {/* Component header */}
      <div className="flex items-center gap-3 px-[18px] pt-4 pb-3">
        <div
          className="w-10 h-10 rounded-[11px] flex items-center justify-center text-lg flex-shrink-0"
          style={{ background: `${comp.color}12`, color: comp.color }}
        >
          {comp.icon}
        </div>
        <div>
          <h3 className="text-[15px] font-bold text-[#001a4d]">{comp.name}</h3>
          <p className="text-[11px] text-[#a5b8d4] mt-0.5">{comp.type}</p>
        </div>
      </div>

      {/* Dimensions */}
      <div className="px-[18px] py-3.5 border-b border-[rgba(0,60,160,0.05)]">
        <div className="text-[10px] font-bold text-[#a5b8d4] uppercase tracking-[1px] mb-2 flex items-center gap-1.5">
          <Ruler className="w-3 h-3" />
          Dimensions
        </div>
        {Object.entries(comp.dims)
          .filter(([key]) => isEditableDim(key))
          .map(([key, val]) => {
          const isChanged = originals?.[key] && originals[key] !== val;
          return (
            <div key={key} className="flex items-center gap-2 py-1.5">
              <span className="text-[12px] text-[#666] w-[80px] flex-shrink-0 font-medium">
                {dimLabel(key)}
              </span>
              <input
                key={`${key}-${val}`}
                type="text"
                defaultValue={val as string}
                aria-label={dimLabel(key)}
                onBlur={(e) => onDimChange(key, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    onDimChange(key, (e.target as HTMLInputElement).value);
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                className={`flex-1 px-2 py-1.5 rounded-[7px] border-[1.5px] text-[13px] font-semibold
                           text-center text-[#001a4d] transition-all focus:outline-none
                           focus:border-[#1a5cb8] focus:shadow-[0_0_0_3px_rgba(0,46,129,0.1)] ${
                             isChanged
                               ? "bg-[#e6eeff] border-[#1a5cb8]"
                               : "bg-white border-[rgba(0,60,160,0.12)]"
                           }`}
              />
              {isChanged && originals?.[key] && (
                <span className="text-[9px] text-[#a5b8d4] whitespace-nowrap" title={`Was: ${originals[key]}`}>
                  was {originals[key]}
                </span>
              )}
            </div>
          );
        })}

        {/* Quick-adjust buttons */}
        <div className="flex gap-1 mt-1.5 flex-wrap">
          {[
            { label: "+2'", delta: 2 },
            { label: "+1'", delta: 1 },
            { label: '+6"', delta: 0.5 },
            { label: "−1'", delta: -1, neg: true },
            { label: "−2'", delta: -2, neg: true },
          ].map((btn) => (
            <button
              key={btn.label}
              onClick={() => onQuickAdjust(btn.delta)}
              className={`px-2 py-1 rounded-[5px] border text-[11px] font-semibold transition-all ${
                btn.neg
                  ? "text-red-500 border-red-100 hover:bg-red-50 hover:border-red-300"
                  : "text-[#4a7ab8] border-[rgba(0,60,160,0.1)] hover:bg-[#e6eeff] hover:border-[#1a5cb8] hover:text-[#002e81]"
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {/* Cascade effect */}
      {comp.downstream.length > 0 && (
        <div className="px-[18px] py-3.5 border-b border-[rgba(0,60,160,0.05)]">
          <div className="text-[10px] font-bold text-[#a5b8d4] uppercase tracking-[1px] mb-2">
            Cascade Effect
          </div>
          <div className="bg-[#eef3ff] border border-[rgba(0,60,160,0.08)] rounded-[10px] p-2.5">
            <div className="text-[10px] font-bold text-[#002e81] uppercase tracking-[0.5px] mb-1.5">
              ↻ Downstream shift preview
            </div>
            {comp.downstream.slice(0, 4).map((dId: string) => {
              const d = components[dId];
              if (!d) return null;
              return (
                <button
                  key={dId}
                  onClick={() => onSelectDownstream(dId)}
                  className="w-full flex items-center gap-1.5 text-[11px] text-[#555] py-1 hover:text-[#002e81] transition-colors"
                >
                  <ChevronUp className="w-3 h-3 text-[#1a5cb8]" />
                  <span>{d.name}</span>
                  <span className="ml-auto text-[10px] font-bold text-[#002e81]">
                    shifts with change
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Constraints */}
      <div className="px-[18px] py-3.5 border-b border-[rgba(0,60,160,0.05)]">
        <div className="text-[10px] font-bold text-[#a5b8d4] uppercase tracking-[1px] mb-2">
          Constraints
        </div>
        {comp.constraints.map(
          (c: { label: string; value: string; ok: boolean }, i: number) => (
            <div key={i} className="flex items-center gap-2 py-1">
              <div
                className={`w-[17px] h-[17px] rounded-full flex items-center justify-center flex-shrink-0 ${
                  c.ok ? "bg-green-50 text-green-600" : "bg-yellow-50 text-yellow-600"
                }`}
              >
                {c.ok ? (
                  <Check className="w-2.5 h-2.5" />
                ) : (
                  <AlertTriangle className="w-2.5 h-2.5" />
                )}
              </div>
              <span className="text-[12px] text-[#666] flex-1">{c.label}</span>
              <span className="text-[11px] font-semibold text-[#333]">{c.value}</span>
            </div>
          )
        )}
      </div>

      {/* Construction notes */}
      <div className="px-[18px] py-3.5 border-b border-[rgba(0,60,160,0.05)]">
        <div className="text-[10px] font-bold text-[#a5b8d4] uppercase tracking-[1px] mb-2">
          Construction Notes
        </div>
        <p className="text-[11px] text-[#666] leading-relaxed">{comp.notes}</p>
      </div>

      {/* Reset button */}
      {hasChanges && (
        <div className="px-[18px] py-3.5">
          <button
            onClick={onReset}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-[9px]
                       border border-[rgba(0,60,160,0.15)] text-[12px] font-semibold
                       text-[#002e81] hover:bg-[#e6eeff] transition-all"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset to Original
          </button>
        </div>
      )}
    </>
  );
}
