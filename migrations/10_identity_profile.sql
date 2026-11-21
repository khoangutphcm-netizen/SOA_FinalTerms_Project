ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS bio text NOT NULL DEFAULT '' CHECK (char_length(bio) <= 240),
ADD COLUMN IF NOT EXISTS avatar_jpeg bytea CHECK (octet_length(avatar_jpeg) <= 98304),
ADD COLUMN IF NOT EXISTS avatar_updated_at timestamptz;