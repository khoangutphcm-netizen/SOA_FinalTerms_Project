BEGIN;

CREATE TABLE IF NOT EXISTS public.wallets (
    user_id uuid PRIMARY KEY,
    balance_vnd bigint NOT NULL DEFAULT 0 CHECK (balance_vnd BETWEEN 0 AND 1000000000)
);

CREATE TABLE IF NOT EXISTS public.wallet_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.wallets(user_id),
    kind text NOT NULL,
    amount_vnd bigint NOT NULL,
    balance_after_vnd bigint NOT NULL CHECK (balance_after_vnd BETWEEN 0 AND 1000000000),
    request_id uuid,
    order_id uuid UNIQUE,
    post_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, request_id),
    FOREIGN KEY (order_id, user_id, post_id) REFERENCES public.orders(id, buyer_id, post_id),
    CHECK (
        (kind = 'TOP_UP' AND amount_vnd > 0 AND request_id IS NOT NULL AND order_id IS NULL AND post_id IS NULL)
        OR (kind = 'PURCHASE' AND amount_vnd < 0 AND request_id IS NULL AND order_id IS NOT NULL AND post_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS wallet_entries_owner_history_idx
    ON public.wallet_entries (user_id, created_at DESC, id);

COMMIT;
