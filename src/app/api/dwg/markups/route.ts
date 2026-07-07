import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/lib/db";
import type { Markup } from "@/lib/dwg/types";

export const dynamic = "force-dynamic";

const MAX_PAYLOAD_BYTES = 500_000;

function isValidMarkupsBySheet(
  value: unknown
): value is Record<string, Markup[]> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }
  return Object.values(value as Record<string, unknown>).every((v) =>
    Array.isArray(v)
  );
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { projectId, markupsBySheet } = body as {
    projectId?: unknown;
    markupsBySheet?: unknown;
  };

  if (typeof projectId !== "string" || projectId.length === 0) {
    return NextResponse.json(
      { error: "projectId must be a non-empty string" },
      { status: 400 }
    );
  }

  if (!isValidMarkupsBySheet(markupsBySheet)) {
    return NextResponse.json(
      { error: "markupsBySheet must be an object of arrays" },
      { status: 400 }
    );
  }

  const markupsJson = JSON.stringify(markupsBySheet);
  if (markupsJson.length > MAX_PAYLOAD_BYTES) {
    return NextResponse.json(
      { error: "Payload too large" },
      { status: 413 }
    );
  }

  const sql = getDb();

  let rows;
  try {
    rows = await sql`
      UPDATE projects
      SET dwg_markups = ${markupsJson}::jsonb
      WHERE id = ${projectId} AND user_id = ${session.user.id}
      RETURNING id
    `;
  } catch (err) {
    console.error("[api/dwg/markups] PATCH failed", { error: String(err) });
    return NextResponse.json({ error: "Failed to save markups" }, { status: 500 });
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
