BEGIN;

CREATE TABLE
    orders (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
        buyer_id uuid NOT NULL, -- Identity.users.id
        post_id uuid NOT NULL, -- Content.posts.id
        amount_vnd bigint NOT NULL CHECK (amount_vnd > 0),
        provider text NOT NULL CHECK (trim(provider) <> ''),
        provider_transaction_id text,
        status text NOT NULL DEFAULT 'PENDING' CHECK (
            status IN ('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REVIEW')
        ),
        created_at timestamptz NOT NULL DEFAULT now (),
        expires_at timestamptz NOT NULL,
        paid_at timestamptz,
        CHECK (expires_at > created_at),
        CHECK (
            status <> 'PAID'
            OR (
                paid_at IS NOT NULL
                AND provider_transaction_id IS NOT NULL
            )
        ),
        UNIQUE (provider, provider_transaction_id),
        UNIQUE (id, buyer_id, post_id)
    );

CREATE UNIQUE INDEX orders_one_pending_idx ON orders (buyer_id, post_id)
WHERE
    status = 'PENDING';

CREATE INDEX orders_history_idx ON orders (buyer_id, created_at DESC, id);

CREATE TABLE
    payment_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
        order_id uuid NOT NULL REFERENCES orders (id),
        provider text NOT NULL CHECK (trim(provider) <> ''),
        event_key text NOT NULL CHECK (trim(event_key) <> ''),
        payload jsonb NOT NULL,
        received_at timestamptz NOT NULL DEFAULT now (),
        UNIQUE (provider, event_key)
    );

CREATE TABLE
    entitlements (
        buyer_id uuid NOT NULL,
        post_id uuid NOT NULL,
        source_order_id uuid NOT NULL,
        granted_at timestamptz NOT NULL DEFAULT now (),
        PRIMARY KEY (buyer_id, post_id),
        FOREIGN KEY (source_order_id, buyer_id, post_id) REFERENCES orders (id, buyer_id, post_id)
    );

CREATE TABLE wallets (
    user_id uuid PRIMARY KEY, -- Identity.users.id
    balance_vnd bigint NOT NULL DEFAULT 0 CHECK (balance_vnd BETWEEN 0 AND 1000000000)
);

CREATE TABLE wallet_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES wallets(user_id),
    kind text NOT NULL,
    amount_vnd bigint NOT NULL,
    balance_after_vnd bigint NOT NULL CHECK (balance_after_vnd BETWEEN 0 AND 1000000000),
    request_id uuid,
    actor_id uuid, -- Identity.users.id of the admin who credited the wallet
    order_id uuid UNIQUE,
    post_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, request_id),
    FOREIGN KEY (order_id, user_id, post_id) REFERENCES orders(id, buyer_id, post_id),
    CONSTRAINT wallet_entries_kind_check CHECK (
        (request_id IS NOT NULL AND order_id IS NULL AND post_id IS NULL AND (
            (kind = 'TOP_UP' AND amount_vnd > 0 AND actor_id IS NULL)
            OR (kind = 'ADMIN_CREDIT' AND amount_vnd > 0 AND actor_id IS NOT NULL)
            OR (kind = 'ADMIN_DEBIT' AND amount_vnd < 0 AND actor_id IS NOT NULL)
        ))
        OR (kind = 'PURCHASE' AND amount_vnd < 0 AND request_id IS NULL
            AND order_id IS NOT NULL AND post_id IS NOT NULL AND actor_id IS NULL)
    )
);

CREATE INDEX wallet_entries_owner_history_idx ON wallet_entries (user_id, created_at DESC, id);

COMMIT;
