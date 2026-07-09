#!/usr/bin/env node
// Reset a demo/UAT project back to a pristine baseline by clearing all
// persisted dimension edits and red markups. Sheet-type classification is left
// intact. Run between UAT runs to re-baseline, then RELOAD the browser tab.
//
//   node scripts/qa/reset-demo.mjs                # resets the default demo project
//   node scripts/qa/reset-demo.mjs <projectId>   # resets a specific project
//
// Reads DATABASE_URL from .env.local (shared Neon = dev AND prod).

import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const DEFAULT_PROJECT = "215a08eb-403d-41c7-b0f9-0fd6cceecac2"; // QA — 24081 Sheet 2 (GA)
const projectId = process.argv[2] || DEFAULT_PROJECT;

function loadDbUrl() {
  const raw = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
  const m = raw.match(/^DATABASE_URL=(.*)$/m);
  if (!m) throw new Error("DATABASE_URL not found in .env.local");
  return m[1].trim().replace(/^["']|["']$/g, "");
}

const sql = neon(loadDbUrl());

const [row] = await sql`SELECT name, dwg_dim_edits, dwg_markups FROM projects WHERE id = ${projectId}`;
if (!row) {
  console.error(`✗ No project ${projectId}`);
  process.exit(1);
}
const deKeys = row.dwg_dim_edits && typeof row.dwg_dim_edits === "object" ? Object.keys(row.dwg_dim_edits).length : 0;
const mkKeys = row.dwg_markups && typeof row.dwg_markups === "object" ? Object.keys(row.dwg_markups).length : 0;
console.log(`Project: ${row.name} (${projectId})`);
console.log(`  before → dim-edit components: ${deKeys}, markup sheets: ${mkKeys}`);

await sql`UPDATE projects SET dwg_dim_edits = NULL, dwg_markups = NULL WHERE id = ${projectId}`;

const [after] = await sql`SELECT dwg_dim_edits, dwg_markups FROM projects WHERE id = ${projectId}`;
const ok = after.dwg_dim_edits === null && after.dwg_markups === null;
console.log(`  after  → dwg_dim_edits: ${after.dwg_dim_edits}, dwg_markups: ${after.dwg_markups}`);
console.log(ok ? "✓ Reset to clean baseline. RELOAD the browser tab to see it." : "✗ Reset did not clear both columns.");
process.exit(ok ? 0 : 1);
