ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz;
