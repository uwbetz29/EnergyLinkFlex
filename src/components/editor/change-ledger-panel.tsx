"use client";

/**
 * Change-ledger panel — the credibility artifact for a bid. A top-bar dropdown
 * listing every edited dimension (old → new, % change) across all components,
 * derived from the store's `originals` vs current `components` via the pure
 * buildChangeLedger. Mirrors the Export dropdown's interaction idiom.
 */

import { useState } from "react";
import { ClipboardList } from "lucide-react";
import { useEditorStore } from "@/stores/editor-store";
import { buildChangeLedger, type LedgerRow } from "@/lib/dwg/change-ledger";

function DirGlyph({ row }: { row: LedgerRow }) {
  const grew = row.deltaInches > 0;
  const glyph =
    row.direction === "vertical" ? (grew ? "↑" : "↓") : grew ? "→" : "←";
  return <span>{glyph}</span>;
}

export function ChangeLedgerPanel() {
  const originals = useEditorStore((s) => s.originals);
  const components = useEditorStore((s) => s.components);
  const [open, setOpen] = useState(false);

  const rows = buildChangeLedger(originals, components);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Change ledger"
        className="px-3 py-1.5 rounded-[7px] text-[11px] font-semibold border border-white/15 bg-white/6 text-white/70 hover:bg-white/12 hover:text-white transition-all flex items-center gap-1.5"
      >
        <ClipboardList className="w-3 h-3" />
        Changes
        {rows.length > 0 && (
          <span className="bg-white/20 text-white text-[9px] px-1.5 py-0.5 rounded-full font-bold">
            {rows.length}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1.5 z-50 w-[340px] max-h-[70vh] overflow-auto rounded-lg bg-white shadow-xl border border-gray-200">
            <div className="sticky top-0 bg-white px-3 py-2 border-b border-gray-100 flex items-center justify-between">
              <span className="text-[12px] font-bold text-gray-800">
                Change Ledger
              </span>
              <span className="text-[10px] text-gray-400">
                {rows.length} {rows.length === 1 ? "change" : "changes"}
              </span>
            </div>

            {rows.length === 0 ? (
              <div className="px-3 py-6 text-center text-[11px] text-gray-400">
                No dimension changes yet. Edit a component to build the bid record.
              </div>
            ) : (
              <ul className="divide-y divide-gray-50">
                {rows.map((row) => {
                  const grew = row.deltaInches > 0;
                  return (
                    <li
                      key={`${row.componentId}:${row.dimKey}`}
                      className="px-3 py-2 flex items-center gap-2"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-semibold text-gray-800 truncate">
                          {row.componentName}
                        </div>
                        <div className="text-[10px] text-gray-500 flex items-center gap-1.5">
                          <span className="uppercase tracking-wide text-gray-400">
                            {row.dimKey}
                          </span>
                          <span className="tabular-nums">{row.oldValue}</span>
                          <span className="text-gray-300">→</span>
                          <span className="tabular-nums font-semibold text-gray-700">
                            {row.newValue}
                          </span>
                        </div>
                      </div>
                      <span
                        className="text-[10px] font-bold rounded-full px-2 py-0.5 flex items-center gap-0.5 shrink-0"
                        style={{
                          background: grew ? "#dcfce7" : "#fee2e2",
                          color: grew ? "#15803d" : "#b91c1c",
                        }}
                      >
                        <DirGlyph row={row} />
                        {Math.abs(Math.round(row.pctChange))}%
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
