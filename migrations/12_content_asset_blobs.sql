CREATE TABLE
    IF NOT EXISTS public.asset_blobs (
        asset_id uuid NOT NULL REFERENCES public.assets (id) ON DELETE CASCADE,
        variant text NOT NULL CHECK (variant IN ('ORIGINAL', 'PREVIEW')),
        object_key text NOT NULL,
        body bytea NOT NULL CHECK (octet_length(body) > 0),
        thumbnail bytea CHECK (octet_length(thumbnail) > 0),
        PRIMARY KEY (asset_id, variant)
    );