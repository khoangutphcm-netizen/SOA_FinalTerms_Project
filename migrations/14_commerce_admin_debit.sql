BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.wallet_entries DROP CONSTRAINT IF EXISTS wallet_entries_kind_check;
ALTER TABLE public.wallet_entries ADD CONSTRAINT wallet_entries_kind_check CHECK (
        (request_id IS NOT NULL AND order_id IS NULL AND post_id IS NULL AND (
            (kind = 'TOP_UP' AND amount_vnd > 0 AND actor_id IS NULL)
            OR (kind = 'ADMIN_CREDIT' AND amount_vnd > 0 AND actor_id IS NOT NULL)
            OR (kind = 'ADMIN_DEBIT' AND amount_vnd < 0 AND actor_id IS NOT NULL)
        ))
        OR (kind = 'PURCHASE' AND amount_vnd < 0 AND request_id IS NULL
            AND order_id IS NOT NULL AND post_id IS NOT NULL AND actor_id IS NULL)
    );
COMMIT;
