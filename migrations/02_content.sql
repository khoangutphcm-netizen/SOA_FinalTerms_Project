BEGIN;

CREATE TABLE posts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id uuid NOT NULL, -- Identity.users.id
    title text NOT NULL CHECK (trim(title) <> ''),
    description text NOT NULL DEFAULT '',
    price_vnd bigint NOT NULL DEFAULT 0 CHECK (price_vnd >= 0),
    status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'HIDDEN')),
    published_at timestamptz,
    view_count bigint NOT NULL DEFAULT 0 CHECK (view_count >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (status <> 'PUBLISHED' OR published_at IS NOT NULL)
);

CREATE TABLE asset_formats (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    extension text NOT NULL CHECK (extension ~ '^[a-z0-9]+$'),
    mime_type text NOT NULL CHECK (mime_type = lower(trim(mime_type)) AND position('/' in mime_type) > 0),
    kind text NOT NULL CHECK (kind IN ('IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT', 'ARCHIVE')),
    enabled boolean NOT NULL DEFAULT true,
    UNIQUE (extension, mime_type)
);

CREATE TABLE assets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id uuid NOT NULL REFERENCES posts(id),
    format_id uuid NOT NULL REFERENCES asset_formats(id),
    original_key text NOT NULL UNIQUE CHECK (trim(original_key) <> ''),
    preview_key text CHECK (preview_key <> original_key AND trim(preview_key) <> ''),
    filename text NOT NULL CHECK (trim(filename) <> ''),
    size_bytes bigint NOT NULL CHECK (size_bytes > 0),
    position integer NOT NULL CHECK (position > 0),
    purpose text NOT NULL DEFAULT 'FULL' CHECK (purpose IN ('PROMO', 'FULL')),
    status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'READY', 'FAILED')),
    UNIQUE (post_id, position) DEFERRABLE INITIALLY IMMEDIATE
);

CREATE TABLE genres (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    name text NOT NULL CHECK (trim(name) <> ''),
    enabled boolean NOT NULL DEFAULT true
);

CREATE TABLE post_genres (
    post_id uuid NOT NULL REFERENCES posts(id),
    genre_id uuid NOT NULL REFERENCES genres(id),
    PRIMARY KEY (post_id, genre_id)
);

CREATE TABLE collections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id uuid NOT NULL, -- Identity.users.id
    title text NOT NULL CHECK (trim(title) <> ''),
    description text NOT NULL DEFAULT '',
    cover_key text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE collection_items (
    collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    post_id uuid NOT NULL REFERENCES posts(id),
    position integer NOT NULL CHECK (position > 0),
    PRIMARY KEY (collection_id, post_id),
    UNIQUE (collection_id, position) DEFERRABLE INITIALLY IMMEDIATE
);

CREATE TABLE homepage_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL CHECK (trim(title) <> ''),
    description text NOT NULL DEFAULT '',
    cover_key text,
    enabled boolean NOT NULL DEFAULT false,
    starts_at timestamptz,
    ends_at timestamptz,
    CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at)
);

CREATE TABLE homepage_event_items (
    event_id uuid NOT NULL REFERENCES homepage_events(id) ON DELETE CASCADE,
    post_id uuid NOT NULL REFERENCES posts(id),
    position integer NOT NULL CHECK (position > 0),
    PRIMARY KEY (event_id, post_id),
    UNIQUE (event_id, position) DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX posts_browse_idx ON posts (published_at DESC, id) WHERE status = 'PUBLISHED';
CREATE INDEX posts_author_idx ON posts (author_id, created_at DESC);
CREATE INDEX post_genres_reverse_idx ON post_genres (genre_id, post_id);

INSERT INTO asset_formats (extension, mime_type, kind, enabled) VALUES
    ('jpg', 'image/jpeg', 'IMAGE', true),
    ('jpeg', 'image/jpeg', 'IMAGE', true),
    ('png', 'image/png', 'IMAGE', true),
    ('webp', 'image/webp', 'IMAGE', true),
    ('mp4', 'video/mp4', 'VIDEO', true),
    ('webm', 'video/webm', 'VIDEO', true),
    ('mp3', 'audio/mpeg', 'AUDIO', false),
    ('wav', 'audio/wav', 'AUDIO', false),
    ('pdf', 'application/pdf', 'DOCUMENT', false),
    ('zip', 'application/zip', 'ARCHIVE', false);

INSERT INTO genres (slug, name) VALUES
    ('thien-nhien', 'Thiên nhiên'), ('doi-song', 'Đời sống'),
    ('du-lich', 'Du lịch'), ('nghe-thuat', 'Nghệ thuật');

COMMIT;
