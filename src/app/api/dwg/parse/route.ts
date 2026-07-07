import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { auth } from "@/auth";
import { parseDwg, extractComponents, parseSvgViewBox } from "@/lib/dwg";
import { put } from "@vercel/blob";
import { getDb } from "@/lib/db";
import { performPreScan, extractDimBlocksFromSvg } from "@/lib/ai/prescan";
import { classifySheetType } from "@/lib/dwg/sheet-type";

export const maxDuration = 60; // Allow up to 60s for large DWG files
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const projectId = formData.get("projectId") as string | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
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

  // Read file buffer
  const buffer = await file.arrayBuffer();

  // Resolve WASM directory
  const wasmDir = path.join(
    process.cwd(),
    "node_modules/@mlightcad/libredwg-web/wasm/"
  );

  // Parse DWG
  const parseResult = await parseDwg(buffer, wasmDir);

  // Extract components
  const viewBox = parseSvgViewBox(parseResult.svg);
  const components = extractComponents(parseResult);
  parseResult.components = components;

  // Classify sheet type: GA sheets are resizable (have real dimensions);
  // P&ID sheets are schematic and skip dim-block extraction + AI pre-scan.
  const sheetType = classifySheetType(parseResult);

  // AI Pre-Scan: identify major system sections from parsed data
  let aiSections = null;
  if (sheetType === "GA") {
    try {
      const dimBlockInfo = extractDimBlocksFromSvg(parseResult.svg);
      const preScanResult = await performPreScan({
        dimensions: parseResult.dimensions,
        components,
        titleBlock: parseResult.titleBlock,
        entitySummary: parseResult.entitySummary,
        viewBox,
        dimBlockInfo,
      });
      aiSections = preScanResult;
      console.log(`[ELF prescan] ${preScanResult.sections.length} sections identified: ${preScanResult.summary}`);
    } catch (err) {
      console.error("[ELF prescan] Failed (non-blocking):", err);
      // Pre-scan failure is non-blocking — the drawing still uploads fine
    }
  } else {
    console.log(`[ELF prescan] skipped — sheetType=${sheetType} (not resizable)`);
  }

  // Upload raw DWG to Blob
  const dwgBlob = await put(
    `projects/${session.user.id}/${projectId}/${file.name}`,
    file,
    { access: "public" }
  );

  // Upload SVG to Blob (for rendering)
  let svgUrl: string | null = null;
  if (parseResult.svg) {
    const svgFilename = file.name.replace(/\.dwg$/i, ".svg");
    const svgBlob = await put(
      `projects/${session.user.id}/${projectId}/${svgFilename}`,
      new Blob([parseResult.svg], { type: "image/svg+xml" }),
      { access: "public" }
    );
    svgUrl = svgBlob.url;
  }

  // Store structured data in database
  const componentData = JSON.stringify(components);
  const layerData = JSON.stringify(parseResult.layers);
  const metadataJson = JSON.stringify(parseResult.titleBlock);
  const aiSectionsJson = aiSections ? JSON.stringify(aiSections) : null;

  await sql`
    UPDATE projects
    SET
      drawing_type = 'dwg',
      dwg_url = ${dwgBlob.url},
      dwg_filename = ${file.name},
      svg_url = ${svgUrl},
      dwg_components = ${componentData}::jsonb,
      dwg_layers = ${layerData}::jsonb,
      dwg_metadata = ${metadataJson}::jsonb,
      dwg_ai_sections = ${aiSectionsJson}::jsonb,
      dwg_sheet_type = ${sheetType},
      updated_at = now()
    WHERE id = ${projectId}
  `;

  return NextResponse.json({
    success: true,
    dwgUrl: dwgBlob.url,
    svgUrl,
    components,
    layers: parseResult.layers,
    blocks: parseResult.blocks,
    titleBlock: parseResult.titleBlock,
    entitySummary: parseResult.entitySummary,
    dimensions: parseResult.dimensions,
    viewBox,
    aiSections,
    sheetType,
  });
}
