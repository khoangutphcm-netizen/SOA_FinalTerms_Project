BEGIN;

CREATE TABLE
    users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
        email_normalized text NOT NULL UNIQUE CHECK (
            email_normalized <> ''
            AND email_normalized = lower(trim(email_normalized))
        ),
        password_hash text NOT NULL CHECK (password_hash <> ''),
        display_name text NOT NULL CHECK (trim(display_name) <> ''),
        role text NOT NULL DEFAULT 'USER' CHECK (role IN ('USER', 'ADMIN')),
        status text NOT NULL DEFAULT 'PENDING_VERIFICATION' CHECK (
            status IN ('ACTIVE', 'DISABLED', 'PENDING_VERIFICATION')
        ),
        email_verified_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now (),
        CHECK (
            status <> 'ACTIVE'
            OR email_verified_at IS NOT NULL
        )
    );

CREATE TABLE
    verification_challenges (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
        user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        purpose text NOT NULL CHECK (purpose IN ('VERIFY_EMAIL', 'RESET_PASSWORD')),
        target_email text NOT NULL CHECK (
            target_email <> ''
            AND target_email = lower(trim(target_email))
        ),
        code_mac bytea NOT NULL CHECK (octet_length(code_mac) = 32),
        attempts_used integer NOT NULL DEFAULT 0 CHECK (attempts_used BETWEEN 0 AND 5),
        created_at timestamptz NOT NULL DEFAULT now (),
        expires_at timestamptz NOT NULL,
        consumed_at timestamptz,
        revoked_at timestamptz,
        CHECK (expires_at > created_at),
        CHECK (
            consumed_at IS NULL
            OR revoked_at IS NULL
        ),
        CHECK (
            attempts_used < 5
            OR revoked_at IS NOT NULL
        )
    );

CREATE UNIQUE INDEX verification_one_open_idx ON verification_challenges (user_id, purpose)
WHERE
    consumed_at IS NULL
    AND revoked_at IS NULL;

CREATE INDEX verification_history_idx ON verification_challenges (user_id, purpose, created_at DESC);

CREATE TABLE
    sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
        user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        refresh_token_hash bytea NOT NULL UNIQUE CHECK (octet_length(refresh_token_hash) = 32),
        created_at timestamptz NOT NULL DEFAULT now (),
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        CHECK (expires_at > created_at)
    );

CREATE INDEX sessions_user_idx ON sessions (user_id);

COMMIT;