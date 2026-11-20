ALTER TABLE public.posts
ADD COLUMN IF NOT EXISTS auto_cycle boolean NOT NULL DEFAULT false;