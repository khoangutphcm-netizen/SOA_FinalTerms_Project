BEGIN;

CREATE TABLE
    likes (
        user_id uuid NOT NULL, -- Identity.users.id
        post_id uuid NOT NULL, -- Content.posts.id
        created_at timestamptz NOT NULL DEFAULT now (),
        PRIMARY KEY (user_id, post_id)
    );

CREATE TABLE
    comments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
        author_id uuid NOT NULL, -- Identity.users.id
        post_id uuid NOT NULL, -- Content.posts.id
        body text NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 1000),
        created_at timestamptz NOT NULL DEFAULT now (),
        deleted_at timestamptz
    );

CREATE TABLE
    reports (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
        reporter_id uuid NOT NULL, -- Identity.users.id
        post_id uuid NOT NULL, -- Content.posts.id
        reason text NOT NULL CHECK (char_length(trim(reason)) BETWEEN 1 AND 1000),
        status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'DISMISSED', 'ACTIONED')),
        created_at timestamptz NOT NULL DEFAULT now (),
        resolved_by uuid, -- Identity.users.id
        resolved_at timestamptz,
        CHECK (
            (
                status = 'OPEN'
                AND resolved_by IS NULL
                AND resolved_at IS NULL
            )
            OR (
                status <> 'OPEN'
                AND resolved_by IS NOT NULL
                AND resolved_at IS NOT NULL
            )
        )
    );

CREATE TABLE
    saved_posts (
        user_id uuid NOT NULL, -- Identity.users.id
        post_id uuid NOT NULL, -- Content.posts.id
        saved_at timestamptz NOT NULL DEFAULT now (),
        PRIMARY KEY (user_id, post_id)
    );

CREATE UNIQUE INDEX reports_one_open_idx ON reports (reporter_id, post_id)
WHERE
    status = 'OPEN';

CREATE INDEX likes_by_post_idx ON likes (post_id);

CREATE INDEX comments_by_post_idx ON comments (post_id, created_at, id)
WHERE
    deleted_at IS NULL;

CREATE INDEX reports_queue_idx ON reports (created_at, id)
WHERE
    status = 'OPEN';

CREATE INDEX saved_posts_recent_idx ON saved_posts (user_id, saved_at DESC, post_id);

COMMIT;