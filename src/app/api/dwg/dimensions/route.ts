import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const MAX_PAYLOAD_BYTES = 500_000;

/** dimEdits shape: { [componentId]: { [dimKey]: editedValue } } */
function isValidDimEdits(value: unknown): value is Record<string, Record<string, string>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value as Record<string, unknown>).every(
    (comp) =>
      typeof comp === "object" &&
      comp !== null &&
      !Array.isArray(comp) &&
      Object.values(comp as Record<string, unknown>).every((v) => typeof v === "string")
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

  const { projectId, dimEdits } = body as {
    projectId?: unknown;
    dimEdits?: unknown;
  };

  if (typeof projectId !== "string" || projectId.length === 0) {
    return NextResponse.json(
      { error: "projectId must be a non-empty string" },
      { status: 400 }
    );
  }

  if (!isValidDimEdits(dimEdits)) {
    return NextResponse.json(
      { error: "dimEdits must be an object of { dimKey: string } maps" },
      { status: 400 }
    );
  }

  const dimEditsJson = JSON.stringify(dimEdits);
  if (dimEditsJson.length > MAX_PAYLOAD_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  const sql = getDb();

  let rows;
  try {
    rows = await sql`
      UPDATE projects
      SET dwg_dim_edits = ${dimEditsJson}::jsonb
      WHERE id = ${projectId} AND user_id = ${session.user.id}
      RETURNING id
    `;
  } catch (err) {
    console.error("[api/dwg/dimensions] PATCH failed", { error: String(err) });
    return NextResponse.json({ error: "Failed to save dimension edits" }, { status: 500 });
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
