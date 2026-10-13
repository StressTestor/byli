ALTER TABLE articles ADD COLUMN IF NOT EXISTS quality_score smallint;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS editorial_reason text;