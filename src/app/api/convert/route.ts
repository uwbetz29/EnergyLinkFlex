import { NextRequest, NextResponse } from "next/server";
import { writeFile, readFile, unlink, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// ODA File Converter paths (install from https://www.opendesign.com/guestfiles/oda_file_converter)
const ODA_PATHS = [
  "/Applications/ODAFileConverter.app/Contents/MacOS/ODAFileConverter",
  "/usr/bin/ODAFileConverter",
  "C:\\Program Files\\ODA\\ODAFileConverter\\ODAFileConverter.exe",
];

async function findODA(): Promise<string | null> {
  for (const p of ODA_PATHS) {
    try {
      await execAsync(`"${p}" --help 2>&1 || true`);
      return p;
    } catch {
      // Try next path
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "dwg") {
      return NextResponse.json(
        { error: "Only DWG files need conversion" },
        { status: 400 }
      );
    }

    // Create temp directories for input and output
    const sessionId = randomUUID();
    const inputDir = join(tmpdir(), `el-convert-in-${sessionId}`);
    const outputDir = join(tmpdir(), `el-convert-out-${sessionId}`);
    await mkdir(inputDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });

    const inputPath = join(inputDir, file.name);
    const outputFileName = file.name.replace(/\.dwg$/i, ".dxf");
    const outputPath = join(outputDir, outputFileName);

    // Write uploaded file to temp
    const bytes = await file.arrayBuffer();
    await writeFile(inputPath, Buffer.from(bytes));

    // Find ODA File Converter
    const odaPath = await findODA();
    if (!odaPath) {
      // Clean up temp files
      await unlink(inputPath).catch(() => {});
      return new NextResponse(
        "DWG conversion requires ODA File Converter. Please install it from https://www.opendesign.com/guestfiles/oda_file_converter or upload a DXF file instead.",
        { status: 501 }
      );
    }

    // Run ODA File Converter
    // Usage: ODAFileConverter <input_dir> <output_dir> <output_version> <output_type> <recurse> <audit>
    // output_type: "DXF" for DXF output
    // output_version: "ACAD2018" for latest compatible version
    const cmd = `"${odaPath}" "${inputDir}" "${outputDir}" "ACAD2018" "DXF" "0" "1"`;

    try {
      await execAsync(cmd, { timeout: 30000 });
    } catch (err) {
      await unlink(inputPath).catch(() => {});
      return new NextResponse(
        `DWG conversion failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        { status: 500 }
      );
    }

    // Read output DXF
    let dxfContent: string;
    try {
      dxfContent = await readFile(outputPath, "utf-8");
    } catch {
      await unlink(inputPath).catch(() => {});
      return new NextResponse(
        "Conversion produced no output. The DWG file may be corrupt or unsupported.",
        { status: 500 }
      );
    }

    // Clean up temp files
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});

    return new NextResponse(dxfContent, {
      headers: { "Content-Type": "text/plain" },
    });
  } catch (err) {
    return new NextResponse(
      `Server error: ${err instanceof Error ? err.message : "Unknown error"}`,
      { status: 500 }
    );
  }
}
