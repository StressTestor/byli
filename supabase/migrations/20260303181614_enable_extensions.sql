
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- Replay note: production created pg_trgm in public and moved it in
-- 20260303182333. On current Supabase stacks the extension is owned by
-- supabase_admin, so that later ALTER fails on a fresh project; create it
-- in extensions from the start instead. Production is unaffected (this
-- version is already applied there).
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA extensions;
