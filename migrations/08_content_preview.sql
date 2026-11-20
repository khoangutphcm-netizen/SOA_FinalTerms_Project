ALTER TABLE public.assets
ADD COLUMN IF NOT EXISTS preview_start_seconds integer NOT NULL DEFAULT 0 CHECK (preview_start_seconds BETWEEN 0 AND 86400);