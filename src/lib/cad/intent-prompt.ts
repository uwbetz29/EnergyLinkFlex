// Intent-based editing prompt — translates natural language to dimension changes

export function buildIntentSystemPrompt(): string {
  return `You are an engineering assistant for SCR/CO catalyst exhaust systems used in gas turbine power generation.

You help users modify engineering drawings by translating natural language instructions into specific dimension changes.

System components (in typical gas flow order):
- Gas Path: Main gas flow from turbine exhaust
- D.I. Duct: Diverter/inlet duct
- T.A. Duct: Transition/adapter duct
- Dist. Grid Duct: Distribution grid duct
- SCR Duct: SCR catalyst housing
- Silencer: Sound attenuation section
- 4000 Stack: Exhaust stack (tallest vertical component)
- Inside Liner: Internal liner within ducts
- Nozzles (N1-N16): Connection points
- Platforms and Ladders: Access structures

Dimensions are in imperial format (feet-inches-fractions). Values are stored in total inches internally.

When the user gives an instruction like "make the stack 5 feet taller", you must:
1. Identify which dimension(s) correspond to the described change
2. Calculate the new value(s)
3. Return the changes via the tool

Use component labels and dimension directions to match the right dimensions.
- "taller" / "shorter" → vertical dimensions
- "wider" / "narrower" → horizontal dimensions
- References to specific components should match by label or type`;
}

export function buildIntentUserMessage(
  intent: string,
  dimensions: Array<{ id: string; displayText: string; value: number; direction: string }>,
  componentGraph: {
    components: Array<{ id: string; type: string; label: string; dimensionIds: string[] }>;
    flowDirection: string;
  } | null
): string {
  let msg = `User instruction: "${intent}"\n\nAvailable dimensions:\n`;

  for (const d of dimensions) {
    const comp = componentGraph?.components.find(c => c.dimensionIds.includes(d.id));
    msg += `- ${d.id}: ${d.displayText} (${d.value.toFixed(2)}" = ${Math.floor(d.value / 12)}'-${(d.value % 12).toFixed(2)}") [${d.direction}]`;
    if (comp) msg += ` — ${comp.label} (${comp.type})`;
    msg += "\n";
  }

  if (componentGraph) {
    msg += `\nRecognized components: ${componentGraph.components.map(c => c.label).join(", ")}`;
    msg += `\nFlow direction: ${componentGraph.flowDirection}`;
  }

  return msg;
}

export const INTENT_TOOL_SCHEMA = {
  name: "apply_intent_changes",
  description: "Apply dimension changes based on the user's natural language instruction",
  input_schema: {
    type: "object" as const,
    properties: {
      changes: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            dimensionId: { type: "string" as const, description: "ID of the dimension to change" },
            newValue: { type: "number" as const, description: "New value in total inches" },
            reasoning: { type: "string" as const, description: "Why this change was made" },
          },
          required: ["dimensionId", "newValue", "reasoning"],
        },
        description: "List of dimension changes to apply",
      },
      overallReasoning: {
        type: "string" as const,
        description: "Overall explanation of what changes were made and why",
      },
    },
    required: ["changes", "overallReasoning"],
  },
};
