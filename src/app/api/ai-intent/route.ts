import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  buildIntentSystemPrompt,
  buildIntentUserMessage,
  INTENT_TOOL_SCHEMA,
} from "@/lib/cad/intent-prompt";

const getClient = () => {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
};

interface RequestBody {
  intent: string;
  dimensions: Array<{ id: string; displayText: string; value: number; direction: string }>;
  componentGraph: {
    components: Array<{ id: string; type: string; label: string; dimensionIds: string[] }>;
    flowDirection: string;
  } | null;
}

export async function POST(request: NextRequest) {
  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.intent || !body.dimensions) {
    return NextResponse.json({ error: "Missing intent or dimensions" }, { status: 400 });
  }

  let client: Anthropic;
  try {
    client = getClient();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "API key error" },
      { status: 500 }
    );
  }

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: buildIntentSystemPrompt(),
      messages: [
        {
          role: "user",
          content: buildIntentUserMessage(body.intent, body.dimensions, body.componentGraph),
        },
      ],
      tools: [INTENT_TOOL_SCHEMA],
      tool_choice: { type: "tool", name: "apply_intent_changes" },
    });

    // Extract tool use result
    const toolUse = response.content.find(
      (block) => block.type === "tool_use" && block.name === "apply_intent_changes"
    );

    if (!toolUse || toolUse.type !== "tool_use") {
      return NextResponse.json(
        { error: "AI did not return changes" },
        { status: 500 }
      );
    }

    const result = toolUse.input as {
      changes: Array<{ dimensionId: string; newValue: number; reasoning: string }>;
      overallReasoning: string;
    };

    // Validate that all referenced dimension IDs exist
    const validIds = new Set(body.dimensions.map(d => d.id));
    const validChanges = result.changes.filter(c => validIds.has(c.dimensionId));

    return NextResponse.json({
      changes: validChanges,
      overallReasoning: result.overallReasoning,
    });
  } catch (err) {
    console.error("[ai-intent] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "AI intent failed" },
      { status: 500 }
    );
  }
}
