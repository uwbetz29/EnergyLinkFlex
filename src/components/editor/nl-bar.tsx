"use client";

import { useState, useRef } from "react";
import { useEditorStore } from "@/stores/editor-store";
import { validateDimValue } from "@/lib/dwg/svg-stretch";
import { Zap, ArrowUp, Loader2, AlertTriangle, Info, ArrowRight } from "lucide-react";

interface AIMessage {
  text: string;
  type: "info" | "success" | "caution" | "critical" | "cascade";
}

export function NLBar() {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
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

  const messageColors: Record<AIMessage["type"], string> = {
    info: "bg-[#f0f4ff] text-[#002e81]",
    success: "bg-emerald-50 text-emerald-800",
    caution: "bg-amber-50 text-amber-800",
    critical: "bg-red-50 text-red-800",
    cascade: "bg-blue-50/60 text-blue-700",
  };

  const messageIcons: Record<AIMessage["type"], React.ReactNode> = {
    info: <Info className="w-3 h-3 flex-shrink-0 mt-0.5" />,
    success: <Zap className="w-3 h-3 flex-shrink-0 mt-0.5" />,
    caution: <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />,
    critical: <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />,
    cascade: <ArrowRight className="w-3 h-3 flex-shrink-0 mt-0.5 ml-2" />,
  };

  return (
    <div className="flex-shrink-0">
      {/* Response messages */}
      {messages.length > 0 && (
        <div className="border-t border-[rgba(0,60,160,0.06)]">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`px-3.5 py-1.5 text-[11px] font-medium flex items-start gap-1.5 ${messageColors[msg.type]} ${
                i > 0 ? "border-t border-black/[0.04]" : ""
              }`}
            >
              {messageIcons[msg.type]}
              <span className="whitespace-pre-wrap">{msg.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Input bar */}
      <div className="h-12 bg-white border-t border-[rgba(0,60,160,0.06)] flex items-center px-3.5 gap-2.5">
        <div
          className="w-[30px] h-[30px] rounded-lg flex items-center justify-center flex-shrink-0"
          style={{
            background: loading
              ? "linear-gradient(135deg, #6b8ab8, #4a6a98)"
              : "linear-gradient(135deg, #1a5cb8, #002e81)",
          }}
        >
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
          ) : (
            <Zap className="w-3.5 h-3.5 text-white" />
          )}
        </div>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
          }}
          disabled={loading}
          placeholder={
            selectedId
              ? `Modify ${components[selectedId]?.name || "component"}... e.g. "make it 3 feet taller"`
              : '"What if the SCR duct were 2 feet taller?" · "Show system dimensions"'
          }
          className="flex-1 border-none outline-none text-[13px] text-[#333] bg-transparent placeholder:text-[#bbb] disabled:opacity-50"
        />
        <span className="text-[10px] text-[#ccc] whitespace-nowrap">
          Enter ↵
        </span>
        <button
          onClick={handleSubmit}
          disabled={loading || !value.trim()}
          className="w-[30px] h-[30px] rounded-[7px] bg-[#002e81] text-white flex items-center justify-center
                     hover:bg-[#0a3d99] transition-colors flex-shrink-0 disabled:opacity-40"
        >
          <ArrowUp className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
