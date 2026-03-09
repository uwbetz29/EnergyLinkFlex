"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useCADStore } from "@/lib/cad/store";
import { Loader2, Wand2 } from "lucide-react";

const EXAMPLE_INTENTS = [
  "make the stack 5 feet taller",
  "increase silencer width by 2 feet",
  "set the SCR duct height to 12'-6\"",
  "reduce all nozzle dimensions by 10%",
  "move the stack up 3 feet",
];

export function IntentBar() {
  const [intent, setIntent] = useState("");
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const { isResizing, lastResizeReasoning, applyIntentChanges, componentGraph } = useCADStore();
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  // Cycle through example placeholders
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % EXAMPLE_INTENTS.length);
    }, 4000);
    return () => clearInterval(intervalRef.current);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!intent.trim() || isResizing) return;
    await applyIntentChanges(intent.trim());
    setIntent("");
  }, [intent, isResizing, applyIntentChanges]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  return (
    <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-20 w-[520px] max-w-[90vw]">
      <div className="bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-[#D4D4D4] p-2">
        <div className="flex items-center gap-2">
          <Wand2 className="w-4 h-4 text-[#93C90F] flex-shrink-0" />
          <input
            type="text"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Try: "${EXAMPLE_INTENTS[placeholderIdx]}"`}
            disabled={isResizing}
            className="flex-1 text-sm bg-transparent border-none outline-none placeholder:text-[#999]"
          />
          <button
            onClick={handleSubmit}
            disabled={!intent.trim() || isResizing}
            className="px-3 py-1 text-xs font-medium text-white bg-[#93C90F] rounded-lg
              hover:bg-[#7AB00D] disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            {isResizing ? <Loader2 className="w-3 h-3 animate-spin" /> : "Apply"}
          </button>
        </div>
        {lastResizeReasoning ? (
          <div className="mt-1.5 text-[10px] text-[#666] px-6 truncate">
            AI: {lastResizeReasoning}
          </div>
        ) : !componentGraph ? (
          <div className="mt-1 text-[10px] text-[#999] px-6">
            Tip: Run AI Analysis first for best results
          </div>
        ) : null}
      </div>
    </div>
  );
}
