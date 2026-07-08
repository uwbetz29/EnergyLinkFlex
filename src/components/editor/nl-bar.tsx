"use client";

import { useState, useRef } from "react";
import { useEditorStore } from "@/stores/editor-store";
import { validateDimValue } from "@/lib/dwg/svg-stretch";
import {
  Loader2,
  AlertTriangle,
  Info,
  Sparkles,
  CheckCircle2,
  CornerDownRight,
} from "lucide-react";

interface AIMessage {
  text: string;
  type: "info" | "success" | "caution" | "critical" | "cascade";
}

export function NLBar() {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const {
    components,
    selectedId,
    sheets,
    activeSheetIndex,
    dwgMetadata,
    select,
    updateDim,
  } = useEditorStore();

  async function handleSubmit() {
    const text = value.trim();
    if (!text || loading) return;

    const selected = selectedId ? components[selectedId] : null;
    const allComps = Object.values(components).map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      dims: c.dims,
      upstream: c.upstream,
      downstream: c.downstream,
    }));

    // Multi-sheet context
    const sheetInfo =
      sheets.length > 1
        ? sheets.map((s) => ({
            sheetNumber: s.sheetNumber,
            label: s.label,
            componentCount: s.components.length,
            correlatedComponents: s.correlationMap
              ? Object.keys(s.correlationMap).length
              : 0,
          }))
        : undefined;

    setLoading(true);
    setMessages([]);
    setValue("");

    try {
      const res = await fetch("/api/ai/modify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction: text,
          selectedComponent: selected
            ? {
                id: selected.id,
                name: selected.name,
                type: selected.type,
                dims: selected.dims,
                upstream: selected.upstream,
                downstream: selected.downstream,
              }
            : null,
          allComponents: allComps,
          sheets: sheetInfo,
          activeSheetIndex,
          metadata: dwgMetadata
            ? {
                drawingNumber: dwgMetadata.drawingNumber,
                title: dwgMetadata.title,
                customer: dwgMetadata.customer,
                scale: dwgMetadata.scale,
              }
            : undefined,
        }),
      });

      if (!res.ok) throw new Error("AI request failed");

      const data = await res.json();
      const newMessages: AIMessage[] = [];

      for (const action of data.actions || []) {
        switch (action.action) {
          case "select":
            if (action.componentId) select(action.componentId);
            if (action.message)
              newMessages.push({ text: action.message, type: "info" });
            break;

          case "updateDim":
            if (action.componentId && action.dimKey && action.value) {
              const check = validateDimValue(action.value);
              if (check.ok) {
                updateDim(action.componentId, action.dimKey, action.value);
                if (action.message)
                  newMessages.push({ text: action.message, type: "success" });
              } else {
                newMessages.push({
                  text: `Ignored invalid value "${action.value}" for ${action.dimKey} — left unchanged.`,
                  type: "caution",
                });
              }
            } else if (action.message) {
              newMessages.push({ text: action.message, type: "success" });
            }
            break;

          case "cascade":
            // Apply the primary change
            if (action.componentId && action.dimKey && action.value) {
              const check = validateDimValue(action.value);
              if (check.ok) {
                updateDim(action.componentId, action.dimKey, action.value);
                if (action.message)
                  newMessages.push({ text: action.message, type: "success" });
              } else {
                newMessages.push({
                  text: `Ignored invalid value "${action.value}" for ${action.dimKey} — left unchanged.`,
                  type: "caution",
                });
              }
            } else if (action.message) {
              newMessages.push({ text: action.message, type: "success" });
            }
            // Apply cascade effects
            if (action.cascadeEffects) {
              for (const effect of action.cascadeEffects) {
                const check = validateDimValue(effect.value);
                if (check.ok) {
                  updateDim(effect.componentId, effect.dimKey, effect.value);
                  newMessages.push({
                    text: `↳ ${effect.componentName}: ${effect.dimKey} → ${effect.value} (${effect.reason})`,
                    type: "cascade",
                  });
                } else {
                  newMessages.push({
                    text: `↳ ${effect.componentName}: ignored invalid ${effect.dimKey} value "${effect.value}" — left unchanged.`,
                    type: "caution",
                  });
                }
              }
            }
            break;

          case "warn":
            newMessages.push({
              text: action.message,
              type: action.severity === "critical" ? "critical" : "caution",
            });
            break;

          case "info":
          default:
            if (action.message)
              newMessages.push({
                text: action.message,
                type: action.severity === "caution" ? "caution" : "info",
              });
            break;
        }
      }

      setMessages(
        newMessages.length > 0
          ? newMessages
          : [{ text: "Done.", type: "info" }]
      );
    } catch {
      setMessages([
        {
          text: 'Could not process. Try: "make the SCR duct 2 feet taller" or "what are the current system dimensions?"',
          type: "caution",
        },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  const messageConfig: Record<
    AIMessage["type"],
    { classes: string; icon: React.ReactNode }
  > = {
    success: {
      classes: "border-emerald-400 bg-emerald-50 text-emerald-800",
      icon: <CheckCircle2 className="w-4 h-4 flex-shrink-0" />,
    },
    caution: {
      classes: "border-amber-400 bg-amber-50 text-amber-800",
      icon: <AlertTriangle className="w-4 h-4 flex-shrink-0" />,
    },
    critical: {
      classes:
        "border-red-500 bg-red-50 text-red-900 font-semibold ring-1 ring-red-200",
      icon: <AlertTriangle className="w-4 h-4 flex-shrink-0" />,
    },
    info: {
      classes: "border-[#1a5cb8] bg-[#f0f4ff] text-[#002e81]",
      icon: <Info className="w-4 h-4 flex-shrink-0" />,
    },
    cascade: {
      classes: "border-blue-300 bg-blue-50/60 text-blue-700 ml-4",
      icon: <CornerDownRight className="w-4 h-4 flex-shrink-0" />,
    },
  };

  const exampleChips = selectedId
    ? ["Make it 2 ft taller", "Widen by 1 ft", "What changes downstream?"]
    : [
        "Show system dimensions",
        "Make the SCR duct 2 ft taller",
        "Raise the stack to 40 ft",
      ];

  return (
    <div className="flex-shrink-0 border-t border-[rgba(0,60,160,0.1)] bg-gradient-to-b from-[#f7f9fe] to-white">
      {/* Zone 1: Heading */}
      <div className="px-3.5 pt-3 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-[#1a5cb8] to-[#002e81]">
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
          <h3 className="text-[13px] font-bold text-[#002e81]">Ask FLEX AI</h3>
          <span className="text-[9px] font-bold uppercase tracking-wide text-[#1a5cb8] bg-[#e6eeff] border border-[rgba(0,60,160,0.15)] rounded-full px-1.5 py-0.5">
            Beta
          </span>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-[#6b7f9e]">
          Describe a change in plain English. I&apos;ll resize the drawing
          and flag anything downstream.
        </p>
      </div>

      {/* Zone 2: Response area (scroll-capped) */}
      {(loading || messages.length > 0) && (
        <div className="max-h-[220px] overflow-y-auto px-3.5 pb-2 space-y-1.5">
          {loading && (
            <div className="flex items-center gap-1.5 text-[12px] text-[#4a6a98] px-2.5 py-1.5">
              <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
              <span>Thinking…</span>
            </div>
          )}
          {messages.map((msg, i) => {
            const cfg = messageConfig[msg.type];
            return (
              <div
                key={i}
                className={`flex items-start gap-1.5 min-w-0 border-l-[3px] rounded-r-md px-2.5 py-1.5 text-[12px] ${cfg.classes}`}
              >
                {cfg.icon}
                <span className="whitespace-pre-wrap min-w-0 break-words">
                  {msg.text}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Zone 3: Example chips */}
      <div className="flex flex-wrap gap-1.5 px-3.5 pb-2.5">
        {exampleChips.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => {
              setValue(chip);
              inputRef.current?.focus();
            }}
            className="text-[11px] font-medium text-[#4a6a98] bg-white border border-[rgba(0,60,160,0.12)] rounded-full px-2.5 py-1 hover:bg-[#e6eeff] hover:border-[#1a5cb8] transition-colors"
          >
            {chip}
          </button>
        ))}
      </div>

      {/* Zone 4: Composer */}
      <div className="px-3.5 pb-3.5">
        <div className="rounded-[12px] border-[1.5px] border-[rgba(0,60,160,0.15)] bg-white focus-within:border-[#1a5cb8] focus-within:shadow-[0_0_0_3px_rgba(0,46,129,0.1)] transition-shadow px-3 py-2">
          <textarea
            ref={inputRef}
            rows={2}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              autoGrowTextarea(e.target);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            disabled={loading}
            placeholder={
              selectedId
                ? `Modify ${components[selectedId]?.name || "component"}…`
                : "Describe a change…"
            }
            className="w-full resize-none overflow-y-auto border-none outline-none text-[13px] text-[#333] bg-transparent placeholder:text-[#bbb] disabled:opacity-50"
          />
          <div className="flex items-center justify-between gap-2 mt-1.5">
            <span className="text-[10px] text-[#a8b8cf] whitespace-nowrap">
              Enter to send · Shift+Enter for newline
            </span>
            <button
              onClick={handleSubmit}
              disabled={loading || !value.trim()}
              className="h-8 px-3.5 rounded-[8px] bg-gradient-to-br from-[#1a5cb8] to-[#002e81] text-white text-[12px] font-bold flex items-center gap-1.5 hover:brightness-110 transition-all flex-shrink-0 disabled:opacity-40"
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function autoGrowTextarea(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 130)}px`;
}
