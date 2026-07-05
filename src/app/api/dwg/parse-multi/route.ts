import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { auth } from "@/auth";
import { parseDwg, extractComponents, parseSvgViewBox } from "@/lib/dwg";
import { correlateSheets, detectSheetView } from "@/lib/dwg/extractor";
import { put } from "@vercel/blob";
import { getDb } from "@/lib/db";
import type { DwgSheet } from "@/lib/dwg/types";

export const maxDuration = 120; // Multi-sheet parsing needs more time
export const dynamic = "force-dynamic";

/**
 * Multi-sheet DWG upload endpoint.
 * Accepts multiple DWG files (sheets of the same system),
 * parses each, correlates components across sheets, and stores everything.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const formData = await req.formData();
  const projectId = formData.get("projectId") as string | null;
  const files = formData.getAll("files") as File[];

  if (files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }
  if (!projectId) {
    return NextResponse.json(
      { error: "No projectId provided" },
      { status: 400 }
    );
  }

  // Verify project ownership
  const sql = getDb();
  const rows = await sql`
    SELECT id FROM projects WHERE id = ${projectId} AND user_id = ${session.user.id}
  `;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const wasmDir = path.join(
    process.cwd(),
    "node_modules/@mlightcad/libredwg-web/wasm/"
  );

  // Parse each sheet
  const sheets: DwgSheet[] = [];
  const allSheetComponents: any[][] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const buffer = await file.arrayBuffer();

    // Parse DWG
    const parseResult = await parseDwg(buffer, wasmDir);
    const components = extractComponents(parseResult);
    parseResult.components = components;

    // Upload raw DWG to Blob
    const dwgBlob = await put(
      `projects/${session.user.id}/${projectId}/sheet_${i + 1}_${file.name}`,
      file,
      { access: "public" }
    );

    // Upload SVG to Blob
    let svgUrl = "";
    if (parseResult.svg) {
      const svgFilename = file.name.replace(/\.dwg$/i, `.sheet${i + 1}.svg`);
      const svgBlob = await put(
        `projects/${session.user.id}/${projectId}/${svgFilename}`,
        new Blob([parseResult.svg], { type: "image/svg+xml" }),
        { access: "public" }
      );
      svgUrl = svgBlob.url;
    }

    // Detect what kind of view this sheet represents
    const viewLabel = detectSheetView(components);

    // Extract sheet number from filename (e.g., "Sheet_2" → 2)
    const sheetMatch = file.name.match(/[Ss]heet[_\s]*(\d+)/);
    const sheetNumber = sheetMatch ? parseInt(sheetMatch[1]) : i + 1;

    sheets.push({
      sheetNumber,
      label: `Sheet ${sheetNumber} — ${viewLabel}`,
      dwgUrl: dwgBlob.url,
      dwgFilename: file.name,
      svgUrl,
      components,
      layers: parseResult.layers,
      metadata: parseResult.titleBlock,
    });

    allSheetComponents.push(components);
  }

  // Correlate components across sheets (match nozzles, centerlines, etc.)
  if (allSheetComponents.length > 1) {
    const correlationMaps = correlateSheets(allSheetComponents);
    for (let i = 0; i < sheets.length; i++) {
      sheets[i].correlationMap = correlationMaps[i];
    }
  }

  // Sort sheets by sheet number
  sheets.sort((a, b) => a.sheetNumber - b.sheetNumber);

  // Store in database — use first sheet as the "primary" for backward compat
  const primarySheet = sheets[0];
  const sheetsJson = JSON.stringify(sheets);
  const componentData = JSON.stringify(primarySheet.components);
  const layerData = JSON.stringify(primarySheet.layers);
  const metadataJson = JSON.stringify(primarySheet.metadata);

  await sql`
    UPDATE projects
    SET
      drawing_type = 'dwg',
      dwg_url = ${primarySheet.dwgUrl},
      dwg_filename = ${primarySheet.dwgFilename},
      svg_url = ${primarySheet.svgUrl},
      dwg_components = ${componentData}::jsonb,
      dwg_layers = ${layerData}::jsonb,
      dwg_metadata = ${metadataJson}::jsonb,
      dwg_sheets = ${sheetsJson}::jsonb,
      updated_at = now()
    WHERE id = ${projectId}
  `;

  return NextResponse.json({
    success: true,
    sheetCount: sheets.length,
    sheets: sheets.map((s) => ({
      sheetNumber: s.sheetNumber,
      label: s.label,
      svgUrl: s.svgUrl,
      componentCount: s.components.length,
      layerCount: s.layers.length,
      correlatedComponents: s.correlationMap
        ? Object.keys(s.correlationMap).length
        : 0,
    })),
  });
}
