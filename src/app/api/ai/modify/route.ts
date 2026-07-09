import { generateText } from "ai";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { SCR_SYSTEM_KNOWLEDGE, THINKING_MODEL } from "@/lib/ai/scr-knowledge";

export const maxDuration = 60;

/* ─── Request / Response Types ─── */

interface ComponentInfo {
  id: string;
  name: string;
  type: string;
  dims: Record<string, string>;
  /** Upstream component IDs (flow direction) */
  upstream?: string[];
  /** Downstream component IDs (flow direction) */
  downstream?: string[];
}

interface SheetInfo {
  sheetNumber: number;
  label: string;
  componentCount: number;
  correlatedComponents: number;
}

interface ModifyRequest {
  instruction: string;
  selectedComponent: ComponentInfo | null;
  allComponents: ComponentInfo[];
  /** Multi-sheet context (if available) */
  sheets?: SheetInfo[];
  /** Active sheet index */
  activeSheetIndex?: number;
  /** Engineering metadata from title block */
  metadata?: {
    drawingNumber?: string | null;
    title?: string | null;
    customer?: string | null;
    scale?: string | null;
  };
}

interface ModifyAction {
  action: "updateDim" | "select" | "info" | "cascade" | "warn";
  componentId?: string;
  componentName?: string;
  dimKey?: string;
  value?: string;
  message: string;
  /** For cascade actions: list of downstream changes implied by this action */
  cascadeEffects?: {
    componentId: string;
    componentName: string;
    dimKey: string;
    value: string;
    reason: string;
  }[];
  /** For warn actions: engineering constraint being violated */
  constraint?: string;
  severity?: "info" | "caution" | "critical";
}

/* ─── SCR/CO Domain Knowledge ─── */

/* SCR/CO domain knowledge imported from shared module */

/* ─── Route Handler ─── */

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: ModifyRequest = await req.json();
  const { instruction, selectedComponent, allComponents, sheets, activeSheetIndex, metadata } = body;

  const componentSummary = allComponents
    .map((c) => {
      const dims = Object.entries(c.dims)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      const connections = [
        c.upstream?.length ? `upstream=[${c.upstream.join(",")}]` : "",
        c.downstream?.length ? `downstream=[${c.downstream.join(",")}]` : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `- ${c.name} (id:${c.id}, type:${c.type}): ${dims} ${connections}`.trim();
    })
    .join("\n");

  const selectedInfo = selectedComponent
    ? `Currently selected: ${selectedComponent.name} (id: ${selectedComponent.id}, type: ${selectedComponent.type})
Dimensions: ${JSON.stringify(selectedComponent.dims, null, 2)}`
    : "No component currently selected.";

  const sheetInfo = sheets && sheets.length > 1
    ? `\nMulti-sheet drawing: ${sheets.map((s, i) => `Sheet ${s.sheetNumber} "${s.label}" (${s.componentCount} components${s.correlatedComponents > 0 ? `, ${s.correlatedComponents} correlated` : ""})`).join(", ")}
Active sheet: ${activeSheetIndex !== undefined ? sheets[activeSheetIndex]?.label ?? "unknown" : "unknown"}`
    : "";

  const drawingInfo = metadata
    ? `\nDrawing: ${metadata.title ?? "untitled"} (${metadata.drawingNumber ?? "no number"})${metadata.customer ? ` for ${metadata.customer}` : ""}${metadata.scale ? ` at ${metadata.scale}` : ""}`
    : "";

  const systemPrompt = `You are the AI configurator engine for EnergyLink FLEX — an intelligent sales tool for SCR/CO catalyst system engineering.

${SCR_SYSTEM_KNOWLEDGE}

## Current Drawing State
${drawingInfo}
${sheetInfo}

Available components:
${componentSummary}

${selectedInfo}

## Response Format
Respond with a JSON object containing an "actions" array. Each action has a type:

1. **updateDim** — Modify a specific dimension:
   {"action":"updateDim", "componentId":"...", "componentName":"...", "dimKey":"...", "value":"...", "message":"..."}

2. **cascade** — Modify a dimension AND show downstream effects:
   {"action":"cascade", "componentId":"...", "componentName":"...", "dimKey":"...", "value":"...", "message":"...",
    "cascadeEffects": [{"componentId":"...", "componentName":"...", "dimKey":"...", "value":"...", "reason":"..."}]}

3. **warn** — Flag an engineering constraint before proceeding:
   {"action":"warn", "message":"...", "constraint":"...", "severity":"caution|critical"}

4. **select** — Select a component for focus:
   {"action":"select", "componentId":"...", "message":"..."}

5. **info** — Provide information, analysis, or recommendations:
   {"action":"info", "message":"...", "severity":"info"}

Optionally, include a top-level "summary" string (sibling of "actions"): ONE plain sentence a salesperson can read aloud, stating what changed and confirming it stays within engineering limits. Omit it if nothing changed.

## Rules
- Match component references by name, type, or nozzle ID (e.g., "N3", "catalyst frame", "stack")
- Dimension keys are typically "Height", "Width", "X Position", "Y Position"
- When modifying heights, check for upstream/downstream cascade effects
- For "what if" questions, use cascade actions to show full impact
- Always quantify changes: "Increasing SCR Duct Height from 15'-0" to 17'-0" (+2'-0")"
- If a change might violate structural/clearance constraints, add a warn action
- Keep messages concise and professional — this is a sales tool for engineers
- For ambiguous requests, prefer info action asking for clarification
- Respond ONLY with valid JSON: {"actions": [...], "summary": "..."}`;

  try {
    const result = await generateText({
      model: THINKING_MODEL as any,
      system: systemPrompt,
      prompt: instruction,
    });

    const text = result.text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({
        actions: [
          {
            action: "info",
            message:
              "I didn't understand that. Try something like:\n• \"Make the SCR duct 2 feet taller\"\n• \"What happens if we extend the stack by 5 feet?\"\n• \"Move nozzle N3 up 6 inches\"\n• \"Show me the current system dimensions\"",
          },
        ],
      });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return NextResponse.json(parsed);
  } catch (error: any) {
    console.error("AI modify error:", error);

    // Fallback to enhanced keyword matching
    return NextResponse.json({
      actions: fallbackParse(instruction, selectedComponent, allComponents),
    });
  }
}

/* ─── Enhanced Fallback Parser ─── */

function fallbackParse(
  instruction: string,
  selected: ModifyRequest["selectedComponent"],
  allComponents: ModifyRequest["allComponents"]
): ModifyAction[] {
  const text = instruction.toLowerCase();

  // Find referenced component
  let target = selected;
  for (const comp of allComponents) {
    const name = comp.name.toLowerCase();
    if (text.includes(name) || text.includes(comp.id)) {
      target = comp;
      break;
    }
    // Nozzle matching: "n3", "nozzle 3", "nozzle n3"
    if (comp.type === "nozzle") {
      const nozzleMatch = comp.name.match(/N(\d+)/i);
      if (nozzleMatch) {
        const nozzleId = `n${nozzleMatch[1]}`;
        if (text.includes(nozzleId) || text.includes(`nozzle ${nozzleMatch[1]}`)) {
          target = comp;
          break;
        }
      }
    }
    // Partial matching (words > 2 chars)
    const words = name.split(/\s+/);
    if (words.some((w) => w.length > 2 && text.includes(w.toLowerCase()))) {
      target = comp;
      break;
    }
  }

  if (!target) {
    // System-level queries
    if (text.includes("show") && (text.includes("all") || text.includes("system") || text.includes("dimension"))) {
      const summary = allComponents
        .slice(0, 8)
        .map((c) => {
          const mainDim = Object.entries(c.dims).slice(0, 2)
            .map(([k, v]) => `${k}: ${v}`).join(", ");
          return `• ${c.name}: ${mainDim}`;
        })
        .join("\n");
      return [{
        action: "info",
        message: `System overview (${allComponents.length} components):\n${summary}`,
      }];
    }

    return [{
      action: "info",
      message:
        "I couldn't determine which component you're referring to. Try mentioning it by name (e.g., \"SCR Duct\", \"Nozzle N3\", \"Stack\") or select one first.",
    }];
  }

  // Parse dimension changes
  const deltaMatch = text.match(/(\d+)\s*(foot|feet|ft|'|inch|inches|")/);
  const isIncrease =
    text.includes("increase") || text.includes("taller") ||
    text.includes("bigger") || text.includes("larger") ||
    text.includes("extend") || text.includes("add") ||
    text.includes("raise") || text.includes("grow");
  const isDecrease =
    text.includes("decrease") || text.includes("shorter") ||
    text.includes("smaller") || text.includes("reduce") ||
    text.includes("shrink") || text.includes("lower");

  const actions: ModifyAction[] = [];

  // Select the component first if not already selected
  if (!selected || selected.id !== target.id) {
    actions.push({
      action: "select",
      componentId: target.id,
      message: `Selecting ${target.name}`,
    });
  }

  if (deltaMatch) {
    const amount = parseInt(deltaMatch[1]);
    const isInches = deltaMatch[2].startsWith("inch") || deltaMatch[2] === '"';
    const sign = isDecrease ? -1 : 1;

    // Determine which dimension to modify
    const dimKey =
      text.includes("height") || text.includes("tall") || text.includes("vertical")
        ? "Height"
        : text.includes("width") || text.includes("wide") || text.includes("horizontal")
          ? "Width"
          : "Height"; // default to height for ducts

    const currentVal = target.dims[dimKey];
    if (currentVal) {
      // Parse the current dimension value
      const ftInMatch = currentVal.match(/(\d+)['\u2032]-?\s*(\d+)/);
      if (ftInMatch) {
        let totalInches = parseInt(ftInMatch[1]) * 12 + parseInt(ftInMatch[2]);
        totalInches += sign * (isInches ? amount : amount * 12);
        const newFt = Math.floor(totalInches / 12);
        const newIn = totalInches % 12;
        const newValue = `${newFt}'-${newIn}"`;

        actions.push({
          action: "updateDim",
          componentId: target.id,
          componentName: target.name,
          dimKey,
          value: newValue,
          message: `${isDecrease ? "Decreasing" : "Increasing"} ${target.name} ${dimKey} from ${currentVal} to ${newValue} (${isDecrease ? "-" : "+"}${amount} ${isInches ? "inches" : "feet"})`,
        });
      } else {
        // Numeric value fallback
        const numVal = parseFloat(currentVal);
        if (!isNaN(numVal)) {
          const delta = sign * (isInches ? amount : amount * 12);
          const newVal = numVal + delta;
          actions.push({
            action: "updateDim",
            componentId: target.id,
            componentName: target.name,
            dimKey,
            value: String(Math.round(newVal * 100) / 100),
            message: `${isDecrease ? "Decreasing" : "Increasing"} ${target.name} ${dimKey} by ${amount} ${isInches ? "inches" : "feet"}`,
          });
        }
      }
    } else {
      actions.push({
        action: "info",
        message: `${target.name} doesn't have a "${dimKey}" dimension. Available: ${Object.keys(target.dims).join(", ")}`,
      });
    }
  } else if (text.includes("what if") || text.includes("impact") || text.includes("cascade")) {
    actions.push({
      action: "info",
      message: `${target.name} current state:\n${Object.entries(target.dims).map(([k, v]) => `• ${k}: ${v}`).join("\n")}\n\nSpecify a change to see cascading effects (e.g., "make it 3 feet taller").`,
    });
  } else if (!isIncrease && !isDecrease) {
    actions.push({
      action: "info",
      message: `Selected ${target.name}.\nDimensions:\n${Object.entries(target.dims).map(([k, v]) => `• ${k}: ${v}`).join("\n")}\n\nTell me what you'd like to change.`,
    });
  }

  return actions;
}
