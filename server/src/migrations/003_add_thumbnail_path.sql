-- Add explicit thumbnail_path column to files table
ALTER TABLE files ADD COLUMN IF NOT EXISTS thumbnail_path TEXT;
