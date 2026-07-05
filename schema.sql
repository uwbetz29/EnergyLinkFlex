-- EnergyLinkFlex: Neon Postgres Schema
-- Run against your Neon database to initialize tables

-- 1. User profiles (replaces Supabase auth.users + user_profiles)
CREATE TABLE IF NOT EXISTS user_profiles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               text UNIQUE NOT NULL,
  display_name        text NOT NULL DEFAULT '',
  avatar_url          text,
  password_hash       text,          -- NULL for Google OAuth users
  system_role         text NOT NULL DEFAULT 'member'
                      CHECK (system_role IN ('super_admin', 'admin', 'member')),
  provider            text NOT NULL DEFAULT 'email',
  reset_token         text,
  reset_token_expires timestamptz,
  last_sign_in_at     timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- 2. Projects
CREATE TABLE IF NOT EXISTS projects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  name            text NOT NULL,
  drawing_type    text NOT NULL DEFAULT 'pdf'
                  CHECK (drawing_type IN ('pdf', 'dwg')),
  pdf_url         text,                -- Vercel Blob URL (PDF or DWG-generated SVG)
  pdf_filename    text,
  dwg_url         text,                -- Vercel Blob URL for original DWG file
  dwg_filename    text,
  svg_url         text,                -- Vercel Blob URL for SVG rendered from DWG
  dwg_components  jsonb,               -- Extracted component data from DWG parsing
  dwg_layers      jsonb,               -- Layer definitions from DWG
  dwg_metadata    jsonb,               -- Title block and drawing metadata
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);

-- 3. Multi-sheet DWG support
-- Each project can have multiple sheets (views) of the same system
ALTER TABLE projects ADD COLUMN IF NOT EXISTS dwg_sheets jsonb;

-- 5. AI pre-scan results (identified system sections with dimensions)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS dwg_ai_sections jsonb;

-- 4. Migration: add DWG columns to existing projects table
-- Run these if the table already exists:
-- ALTER TABLE projects ADD COLUMN IF NOT EXISTS drawing_type text NOT NULL DEFAULT 'pdf' CHECK (drawing_type IN ('pdf', 'dwg'));
-- ALTER TABLE projects ADD COLUMN IF NOT EXISTS dwg_url text;
-- ALTER TABLE projects ADD COLUMN IF NOT EXISTS dwg_filename text;
-- ALTER TABLE projects ADD COLUMN IF NOT EXISTS svg_url text;
-- ALTER TABLE projects ADD COLUMN IF NOT EXISTS dwg_components jsonb;
-- ALTER TABLE projects ADD COLUMN IF NOT EXISTS dwg_layers jsonb;
-- ALTER TABLE projects ADD COLUMN IF NOT EXISTS dwg_metadata jsonb;
