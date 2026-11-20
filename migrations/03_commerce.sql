BEGIN;

CREATE TABLE orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    buyer_id uuid NOT NULL, -- Identity.users.id
    post_id uuid NOT NULL, -- Content.posts.id
    amount_vnd bigint NOT NULL CHECK (amount_vnd > 0),
    provider text NOT NULL CHECK (trim(provider) <> ''),
    provider_transaction_id text,
    status text NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REVIEW')),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    paid_at timestamptz,
    CHECK (expires_at > created_at),
    CHECK (status <> 'PAID' OR (paid_at IS NOT NULL AND provider_transaction_id IS NOT NULL)),
    UNIQUE (provider, provider_transaction_id),
    UNIQUE (id, buyer_id, post_id)
);

CREATE UNIQUE INDEX orders_one_pending_idx ON orders (buyer_id, post_id)
    WHERE status = 'PENDING';
CREATE INDEX orders_history_idx ON orders (buyer_id, created_at DESC, id);

CREATE TABLE payment_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES orders(id),
    provider text NOT NULL CHECK (trim(provider) <> ''),
    event_key text NOT NULL CHECK (trim(event_key) <> ''),
    payload jsonb NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider, event_key)
);

CREATE TABLE entitlements (
    buyer_id uuid NOT NULL,
    post_id uuid NOT NULL,
    source_order_id uuid NOT NULL,
    granted_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (buyer_id, post_id),
    FOREIGN KEY (source_order_id, buyer_id, post_id) REFERENCES orders(id, buyer_id, post_id)
);

COMMIT;
