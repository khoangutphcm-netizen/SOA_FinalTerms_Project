-- Run this migration on the PCK Content database only.
-- It preserves the existing DRAFT/PUBLISHED/HIDDEN status model and adds
-- explicit moderation state plus an audit trail for hide/restore/takedown.

BEGIN;

ALTER TABLE public.posts
    ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz,
    ADD COLUMN IF NOT EXISTS moderation_state text NOT NULL DEFAULT 'CLEAR',
    ADD COLUMN IF NOT EXISTS moderation_reason text,
    ADD COLUMN IF NOT EXISTS moderated_at timestamptz,
    ADD COLUMN IF NOT EXISTS moderated_by uuid;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.posts'::regclass
          AND conname = 'posts_moderation_state_check'
    ) THEN
        ALTER TABLE public.posts
            ADD CONSTRAINT posts_moderation_state_check
            CHECK (moderation_state IN ('CLEAR', 'TEMP_HIDDEN', 'TAKEN_DOWN'));
    END IF;
END
$migration$;

CREATE TABLE IF NOT EXISTS public.post_moderation_actions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE RESTRICT,
    actor_id uuid NOT NULL, -- Identity.users.id; separate database, so no cross-DB FK
    actor_kind text NOT NULL CHECK (actor_kind IN ('AUTHOR', 'ADMIN')),
    action text NOT NULL CHECK (action IN ('WITHDRAW', 'HIDE', 'RESTORE', 'TAKEDOWN', 'REINSTATE')),
    reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
        action NOT IN ('HIDE', 'TAKEDOWN')
        OR (reason IS NOT NULL AND trim(reason) <> '')
    ),
    CHECK (
        (action = 'WITHDRAW' AND actor_kind = 'AUTHOR')
        OR (action <> 'WITHDRAW' AND actor_kind = 'ADMIN')
    )
);

CREATE INDEX IF NOT EXISTS post_moderation_actions_history_idx
    ON public.post_moderation_actions (post_id, created_at DESC, id);

COMMIT;
