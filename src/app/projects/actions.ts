"use server";

import { auth } from "@/auth";
import { getDb } from "@/lib/db";
import { put, del } from "@vercel/blob";
import type { DwgComponent, DwgLayer, DwgTitleBlock, DwgSheet } from "@/lib/dwg/types";
import type { PreScanResult } from "@/lib/ai/prescan";

export interface Project {
  id: string;
  name: string;
  drawing_type: "pdf" | "dwg";
  pdf_url: string | null;
  pdf_filename: string | null;
  dwg_url: string | null;
  dwg_filename: string | null;
  svg_url: string | null;
  dwg_components: DwgComponent[] | null;
  dwg_layers: DwgLayer[] | null;
  dwg_metadata: DwgTitleBlock | null;
  dwg_sheets: DwgSheet[] | null;
  dwg_ai_sections: PreScanResult | null;
  created_at: string;
  updated_at: string;
}

async function requireAuth() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  return session.user;
}

export async function createProject(name: string): Promise<{ id: string }> {
  const user = await requireAuth();
  const sql = getDb();

  const rows = await sql`
    INSERT INTO projects (user_id, name)
    VALUES (${user.id}, ${name})
    RETURNING id
  `;

  return { id: rows[0].id as string };
}

export async function listProjects(): Promise<Project[]> {
  const user = await requireAuth();
  const sql = getDb();

  const rows = await sql`
    SELECT id, name, drawing_type, pdf_url, pdf_filename,
           dwg_url, dwg_filename, svg_url,
           dwg_components, dwg_layers, dwg_metadata, dwg_sheets, dwg_ai_sections,
           created_at, updated_at
    FROM projects
    WHERE user_id = ${user.id}
    ORDER BY updated_at DESC
  `;

  return rows as unknown as Project[];
}

export async function getProject(projectId: string): Promise<Project> {
  const user = await requireAuth();
  const sql = getDb();

  const rows = await sql`
    SELECT id, name, drawing_type, pdf_url, pdf_filename,
           dwg_url, dwg_filename, svg_url,
           dwg_components, dwg_layers, dwg_metadata, dwg_sheets, dwg_ai_sections,
           created_at, updated_at
    FROM projects
    WHERE id = ${projectId} AND user_id = ${user.id}
  `;

  if (rows.length === 0) throw new Error("Project not found");
  return rows[0] as unknown as Project;
}

export async function getProjectPdfUrl(projectId: string): Promise<string> {
  const user = await requireAuth();
  const sql = getDb();

  const rows = await sql`
    SELECT pdf_url FROM projects
    WHERE id = ${projectId} AND user_id = ${user.id}
  `;

  if (rows.length === 0) throw new Error("Project not found");
  if (!rows[0].pdf_url) throw new Error("No PDF uploaded for this project");

  return rows[0].pdf_url as string;
}

export async function uploadProjectPdf(
  projectId: string,
  formData: FormData
): Promise<{ url: string }> {
  const user = await requireAuth();
  const sql = getDb();

  // Verify project ownership
  const rows = await sql`
    SELECT id FROM projects WHERE id = ${projectId} AND user_id = ${user.id}
  `;
  if (rows.length === 0) throw new Error("Project not found");

  const file = formData.get("file") as File;
  if (!file) throw new Error("No file provided");

  // Upload to Vercel Blob
  const blob = await put(`projects/${user.id}/${projectId}/${file.name}`, file, {
    access: "public",
  });

  // Update project row
  await sql`
    UPDATE projects
    SET pdf_url = ${blob.url}, pdf_filename = ${file.name},
        drawing_type = 'pdf', updated_at = now()
    WHERE id = ${projectId}
  `;

  return { url: blob.url };
}

export async function renameProject(
  projectId: string,
  name: string
): Promise<void> {
  const user = await requireAuth();
  const sql = getDb();

  const rows = await sql`
    SELECT id FROM projects WHERE id = ${projectId} AND user_id = ${user.id}
  `;
  if (rows.length === 0) throw new Error("Project not found");

  await sql`
    UPDATE projects SET name = ${name}, updated_at = now()
    WHERE id = ${projectId}
  `;
}

export async function deleteProject(projectId: string): Promise<void> {
  const user = await requireAuth();
  const sql = getDb();

  const rows = await sql`
    SELECT pdf_url, dwg_url, svg_url FROM projects
    WHERE id = ${projectId} AND user_id = ${user.id}
  `;
  if (rows.length === 0) throw new Error("Project not found");

  // Delete all associated blobs
  const urls = [rows[0].pdf_url, rows[0].dwg_url, rows[0].svg_url].filter(
    Boolean
  ) as string[];
  if (urls.length > 0) {
    await Promise.all(urls.map((url) => del(url)));
  }

  await sql`DELETE FROM projects WHERE id = ${projectId}`;
}

export async function deleteProjectDrawing(projectId: string): Promise<void> {
  const user = await requireAuth();
  const sql = getDb();

  const rows = await sql`
    SELECT pdf_url, dwg_url, svg_url FROM projects
    WHERE id = ${projectId} AND user_id = ${user.id}
  `;
  if (rows.length === 0) throw new Error("Project not found");

  // Delete all associated blobs
  const urls = [rows[0].pdf_url, rows[0].dwg_url, rows[0].svg_url].filter(
    Boolean
  ) as string[];
  await Promise.all(urls.map((url) => del(url)));

  await sql`
    UPDATE projects SET
      drawing_type = 'pdf',
      pdf_url = NULL, pdf_filename = NULL,
      dwg_url = NULL, dwg_filename = NULL,
      svg_url = NULL,
      dwg_components = NULL, dwg_layers = NULL, dwg_metadata = NULL,
      dwg_sheets = NULL,
      updated_at = now()
    WHERE id = ${projectId}
  `;
}
